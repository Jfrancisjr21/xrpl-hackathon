import { CreditSummary } from "@hack/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/db";
import { cachedWithFallback, demoBureau, type PullCredit } from "./credit";
import { isoftpullBureau, summarize } from "./isoftpull";

const ALICE = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb";
const BOB = "rGgZFNrAko9bofdegqwMq2TxLVyXJnUn95";
const DEPOSITOR = "rhQfme96j81aru3i6rFsYEexx5NP7LBe98";
const wallets = [
  { role: "alice" as const, label: "Alice", address: ALICE },
  { role: "bob" as const, label: "Bob", address: BOB },
  { role: "depositor" as const, label: "Depositor", address: DEPOSITOR },
];

// Trimmed from the real demo-mode response for test applicant A: scores and reason codes only.
const fico8 = (score: number, reasons: (string | null)[] = []) => ({ full_feed: { credit_score: { fico_8: { score_model: "FICO 8", score, reason_codes: reasons } } } });
const applicantA = {
  reports: {
    link: "https://app.isoftpull.com/…",
    experian: { status: "success", ...fico8(742, [null, "Amount owed on accounts too high", null]) },
    equifax: { status: "success", ...fico8(775) },
    transunion: { status: "success", ...fico8(780) },
  },
};

describe("summarize", () => {
  it("keeps the FICO 8 score per bureau, the middle score and the reason codes, nothing else", () => {
    const s = CreditSummary.parse(summarize(applicantA, "2026-10-24T22:00:00.000Z"));
    expect(s).toEqual({
      provider: "isoftpull", pullType: "soft", pulledAt: "2026-10-24T22:00:00.000Z", fileFound: true,
      scores: [
        { bureau: "experian", model: "FICO 8", score: 742 },
        { bureau: "equifax", model: "FICO 8", score: 775 },
        { bureau: "transunion", model: "FICO 8", score: 780 },
      ],
      middleScore: 775,
      reasonCodes: ["Amount owed on accounts too high"],
    });
  });

  it("treats no-hit, frozen and failed bureaus as no score", () => {
    const thin = summarize({ reports: { experian: { status: "failure", failure_type: "no-hit" }, equifax: { status: "failure", failure_type: "freeze" } } });
    expect(thin).toMatchObject({ fileFound: false, scores: [], middleScore: null });
  });

  it("uses the lower middle with two scores, and ignores impossible values", () => {
    const two = summarize({ reports: { experian: { status: "success", ...fico8(700) }, equifax: { status: "success", ...fico8(640) }, transunion: { status: "success", ...fico8(999) } } });
    expect(two.middleScore).toBe(640);
    expect(two.scores).toHaveLength(2);
  });
});

describe("isoftpullBureau", () => {
  let requests: { url: string; headers: Record<string, string>; body: Record<string, string> }[];
  const fakeFetch = (status = 200, body: unknown = applicantA) =>
    (async (url: string, init: RequestInit) => {
      requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  const creds = { apiKey: "key", apiSecret: "secret" };
  beforeEach(() => { requests = []; });

  it("sends the persona's fictitious test applicant as a soft pull (no SSN or date of birth)", async () => {
    await isoftpullBureau(wallets, creds, fakeFetch())(ALICE);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://app.isoftpull.com/api/v2/reports");
    expect(requests[0].headers).toMatchObject({ "api-key": "key", "api-secret": "secret" });
    expect(requests[0].body).toMatchObject({ first_name: "Steve", last_name: "Johnson" });
    expect(requests[0].body).not.toHaveProperty("ssn");
    expect(requests[0].body).not.toHaveProperty("date_of_birth");
  });

  it("never pulls a wallet without a test identity", async () => {
    const s = await isoftpullBureau(wallets, creds, fakeFetch())(DEPOSITOR);
    expect(s.fileFound).toBe(false);
    expect(requests).toEqual([]);
  });

  it("throws on an HTTP error or a failure body, so the caller can fall back", async () => {
    await expect(isoftpullBureau(wallets, creds, fakeFetch(500))(ALICE)).rejects.toThrow(/HTTP 500/);
    await expect(isoftpullBureau(wallets, creds, fakeFetch(200, { status: "failure", message: "No pulls left" }))(ALICE)).rejects.toThrow(/No pulls left/);
  });
});

describe("cachedWithFallback", () => {
  let db: Db, calls: number;
  const primary: PullCredit = async () => { calls++; return summarize(applicantA); };
  beforeEach(() => { db = openDb(":memory:"); calls = 0; });

  it("reuses a pull from the last 24 hours instead of pulling again", async () => {
    const pull = cachedWithFallback(db, primary, demoBureau(wallets));
    await pull(ALICE);
    const again = await pull(ALICE);
    expect(calls).toBe(1);
    expect(again).toMatchObject({ provider: "isoftpull", middleScore: 775 });
  });

  it("pulls again once the cached pull is too old", async () => {
    await cachedWithFallback(db, primary, demoBureau(wallets))(ALICE);
    await cachedWithFallback(db, primary, demoBureau(wallets), 0)(ALICE);
    expect(calls).toBe(2);
  });

  it("falls back to the demo bureau on failure, labelled as demo, and does not cache it", async () => {
    const original = console.error;
    console.error = () => {};
    const failing: PullCredit = async () => { calls++; throw new Error("network down"); };
    const s = await cachedWithFallback(db, failing, demoBureau(wallets))(ALICE);
    console.error = original;
    expect(s).toMatchObject({ provider: "demo", middleScore: 775 });
    await cachedWithFallback(db, primary, demoBureau(wallets))(ALICE);
    expect(calls).toBe(2); // the fallback answer was not cached, so the next call tries the real bureau
  });
});
