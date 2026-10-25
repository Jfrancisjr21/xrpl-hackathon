import type { CreditSummary, DemoWallet, Role } from "@hack/shared";
import type { PullCredit } from "./credit";

// iSoftpull's fictitious test applicants (their public "Test Applicants" PDF). They only return reports in Demo Mode.
// Only these are ever sent: any other address has no test identity and is never pulled, so no real person is checked.
// Soft pull: name and address only, no SSN or date of birth.
const TEST_APPLICANTS: Partial<Record<Role, Record<string, string>>> = {
  alice: { first_name: "Steve", last_name: "Johnson", address: "3557 Lancer Way", city: "Carlsbad", state: "California", zip: "92008" }, // A, ~750
  carol: { first_name: "John", last_name: "Dough", address: "310 Tamarack Ave", city: "Carlsbad", state: "California", zip: "92010" }, // B, ~600
  bob: { first_name: "Jeff", last_name: "Nascore", address: "1999 California St", city: "Oceanside", state: "California", zip: "92054" }, // E, no score
};

const BUREAUS = ["experian", "equifax", "transunion"] as const;
const ENDPOINT = "https://app.isoftpull.com/api/v2/reports";

// Keep only scores and reason codes. Everything else in the report (names, addresses, accounts, PDF links) is dropped here.
export function summarize(response: unknown, pulledAt = new Date().toISOString()): CreditSummary {
  const reports = (response as { reports?: Record<string, any> })?.reports ?? {};
  const scores: CreditSummary["scores"] = [];
  let reasonCodes: string[] = [];
  for (const bureau of BUREAUS) {
    const fico8 = reports[bureau]?.status === "success" ? reports[bureau]?.full_feed?.credit_score?.fico_8 : undefined;
    const score = Number(fico8?.score);
    if (!Number.isInteger(score) || score < 300 || score > 850) continue; // no-hit, frozen or no FICO 8: not a score
    scores.push({ bureau, model: "FICO 8", score });
    if (!reasonCodes.length) reasonCodes = (fico8.reason_codes ?? []).filter((r: unknown): r is string => typeof r === "string" && r.length > 0);
  }
  const sorted = scores.map((s) => s.score).sort((a, b) => a - b);
  return {
    provider: "isoftpull",
    pullType: "soft",
    pulledAt,
    fileFound: sorted.length > 0,
    scores,
    middleScore: sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null, // middle of three, like a mortgage lender
    reasonCodes: reasonCodes.slice(0, 4),
  };
}

const noFile = (): CreditSummary => ({
  provider: "isoftpull", pullType: "soft", pulledAt: new Date().toISOString(), fileFound: false, scores: [], middleScore: null, reasonCodes: [],
});

export function isoftpullBureau(wallets: DemoWallet[], creds: { apiKey: string; apiSecret: string }, fetchImpl: typeof fetch = fetch): PullCredit {
  return async (address) => {
    const role = wallets.find((w) => w.address === address)?.role;
    const applicant = role ? TEST_APPLICANTS[role] : undefined;
    if (!applicant) return noFile(); // no test identity for this wallet: never pulled
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "api-key": creds.apiKey, "api-secret": creds.apiSecret, "content-type": "application/json" },
      body: JSON.stringify(applicant),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`iSoftpull answered HTTP ${res.status}`);
    const body = (await res.json()) as { status?: string; message?: string };
    if (body.status === "failure") throw new Error(`iSoftpull: ${body.message ?? "request failed"}`);
    return summarize(body);
  };
}
