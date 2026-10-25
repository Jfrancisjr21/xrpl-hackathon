import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { LedgerService, ScoreToken, ScoreTokenFields } from "@hack/ledger";
import { ScoreTokenView, VerifyResult, type Decision } from "@hack/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createApplication, latestScoreToken, listAudit, openDb, transition, type Db } from "../db/db";
import { issuePassport } from "../services/passport";
import { testUnderwrite } from "./test-underwrite";

const KEY = "test-broker-key-123";
const ALICE = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb";
const MALLORY = "rPXGUmAeAV7YMtxu8pv8PuHPrTzw49YVtP";
const ISSUER = "rnSm3mqQVHfRg4oD4zuLJCtNb8EBf9g5Fp";
const CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
const tx = (c: string) => ({ hash: c.repeat(64), result: "tesSUCCESS", explorerUrl: `https://devnet.xrpl.org/transactions/${c.repeat(64)}` });

// Fake ledger keeps one passport per wallet, like the real issuer does.
let tokens: Map<string, ScoreToken>;
let issued: { address: string; fields: ScoreTokenFields }[];
let failIssue: boolean;
const fakeLedger = {
  getWallets: () => [{ role: "alice", label: "Alice", address: ALICE }],
  issueScoreToken: async (address: string, fields: ScoreTokenFields) => {
    if (failIssue) throw new Error("tecINSUFFICIENT_RESERVE");
    issued.push({ address, fields });
    const now = new Date();
    tokens.set(address, {
      ...fields, nftId: "E".repeat(64), cid: CID, issuer: ISSUER, holder: address,
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 90 * 86_400_000).toISOString(), expired: false,
    });
    return { nftId: "E".repeat(64), cid: CID, tx: tx("1"), moveTx: tx("2") };
  },
  getScoreToken: async (address: string) => tokens.get(address) ?? null,
  revokeScoreToken: async (address: string) => (tokens.delete(address) ? tx("3") : null),
  getScoreRecord: async (cid: string) => (cid === CID ? Buffer.from('{"v":1,"lcs":87}') : null),
} as unknown as LedgerService;

const decision = (over: Partial<Decision> = {}): Decision => ({
  approved: true, outcome: "approved", sanctions: { blocked: false }, banned: false,
  facts: { ageDays: 365, txCountSample: 120, trustlineCount: 4, hasCredential: true }, featureSource: "demo-profile",
  credit: { provider: "demo", pullType: "soft", pulledAt: "2026-10-24T22:00:00.000Z", fileFound: true, scores: [], middleScore: 775, reasonCodes: [] },
  score: { age: 30, activity: 18, trustlines: 20, credential: 20, wallet: 88, paidOffBonus: 0, internal: 88, credit: 86, total: 87 },
  minScore: 50, interestRate: 7600, approvalLevel: "A", maxAmount: "4000", maxPaymentTotal: 12, collateralRequired: null,
  reasons: ["ok"], explanation: "x", explanationSource: "template", ...over,
});
const activeApp = (d = decision()) => {
  const a = createApplication(db, { borrowerAddress: ALICE, amount: "500", paymentTotal: 3, status: "pending_review", decision: d, decisionHash: "ab".repeat(32) });
  transition(db, a.id, ["pending_review"], "originating");
  return transition(db, a.id, ["originating"], "active", { loanId: "C".repeat(64), tx: tx("9") })!;
};

let db: Db, server: Server, base: string;
beforeEach(() => {
  process.env.BROKER_KEY = KEY;
  db = openDb(":memory:");
  tokens = new Map();
  issued = [];
  failIssue = false;
  server = createApp({ db, ledger: fakeLedger, underwrite: testUnderwrite }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => server.close());

const call = async (path: string, init: { method?: string; body?: unknown; key?: boolean } = {}) => {
  const res = await fetch(base + path, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.key ? { "x-broker-key": KEY } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, type: res.headers.get("content-type") };
};

describe("issuePassport", () => {
  it("publishes the LCS, on-chain score, level and flags, and records it as held", async () => {
    const app = activeApp();
    await issuePassport(db, fakeLedger, app);
    expect(issued[0]).toEqual({
      address: ALICE,
      fields: { lcs: 87, onChainScore: 88, level: "A", kyc: true, credit: true, lending: true, decisionHash: "ab".repeat(32) },
    });
    expect(latestScoreToken(db, ALICE)).toMatchObject({ status: "held", cid: CID, nft_id: "E".repeat(64) });
    expect(listAudit(db)[0]).toMatchObject({ action: "score_token_issued", note: `ipfs://${CID}` });
  });

  it("refuses a secured or unscored decision, and records why without throwing", async () => {
    await issuePassport(db, fakeLedger, activeApp(decision({ approvalLevel: "secured" })));
    expect(latestScoreToken(db, ALICE)).toMatchObject({ status: "failed", error: "Only unsecured loans at level A, B or C get a passport" });
    expect(issued).toEqual([]);
  });

  it("records a ledger failure as failed", async () => {
    failIssue = true;
    await issuePassport(db, fakeLedger, activeApp());
    expect(latestScoreToken(db, ALICE)).toMatchObject({ status: "failed", error: "tecINSUFFICIENT_RESERVE" });
  });
});

describe("GET /api/verify/:address", () => {
  it("is public and says not verified for a wallet without a passport", async () => {
    expect(await call(`/api/verify/${MALLORY}`)).toMatchObject({ status: 200, body: { address: MALLORY, verified: false, reason: "no_token" } });
  });

  it("verifies a wallet with a passport, with the mint link, and no broker key", async () => {
    await issuePassport(db, fakeLedger, activeApp());
    const r = await call(`/api/verify/${ALICE}`);
    const v = VerifyResult.parse(r.body);
    expect(v).toMatchObject({ verified: true, token: { score: 87, level: "A", kyc: true, credit: true, lending: true, cid: CID, holder: ALICE, txUrl: tx("1").explorerUrl } });
  });

  it("does not verify an expired passport", async () => {
    await issuePassport(db, fakeLedger, activeApp());
    tokens.set(ALICE, { ...tokens.get(ALICE)!, expired: true });
    expect((await call(`/api/verify/${ALICE}`)).body).toMatchObject({ verified: false, reason: "expired" });
  });

  it("answers 400 for something that is not an address", async () => {
    expect((await call("/api/verify/not-an-address")).body.fields).toHaveProperty("address");
  });
});

describe("/api/score-tokens", () => {
  it("shows our record plus the ledger state, and null status when never issued", async () => {
    expect(ScoreTokenView.parse((await call(`/api/score-tokens/${ALICE}`)).body)).toMatchObject({ status: null, onLedger: null });
    await issuePassport(db, fakeLedger, activeApp());
    const v = ScoreTokenView.parse((await call(`/api/score-tokens/${ALICE}`)).body);
    expect(v).toMatchObject({ status: "held", mintTx: tx("1"), moveTx: tx("2"), onLedger: { lcs: 87 } });
  });

  it("lets the broker issue by hand, refuses a second one without replace, and reissues with it", async () => {
    const app = activeApp();
    expect((await call("/api/score-tokens", { method: "POST", body: { applicationId: app.id } })).status).toBe(401);
    expect((await call("/api/score-tokens", { method: "POST", key: true, body: { applicationId: app.id } })).status).toBe(201);
    expect((await call("/api/score-tokens", { method: "POST", key: true, body: { applicationId: app.id } })).status).toBe(409);
    expect((await call("/api/score-tokens", { method: "POST", key: true, body: { applicationId: app.id, replace: true } })).status).toBe(201);
    expect(issued).toHaveLength(2);
  });

  it("refuses an application without an active loan", async () => {
    const a = createApplication(db, { borrowerAddress: ALICE, amount: "500", paymentTotal: 3, status: "pending_review", decision: decision() });
    expect((await call("/api/score-tokens", { method: "POST", key: true, body: { applicationId: a.id } })).status).toBe(409);
  });

  it("lets the broker revoke, after which the wallet no longer verifies", async () => {
    await issuePassport(db, fakeLedger, activeApp());
    expect((await call(`/api/score-tokens/${ALICE}`, { method: "DELETE", key: true })).body.status).toBe("revoked");
    expect((await call(`/api/verify/${ALICE}`)).body.verified).toBe(false);
    expect((await call(`/api/score-tokens/${ALICE}`, { method: "DELETE", key: true })).status).toBe(404);
  });
});

describe("GET /api/passports/:cid", () => {
  it("serves the raw record as JSON, 404 for an unknown CID, 400 for junk", async () => {
    const r = await call(`/api/passports/${CID}`);
    expect(r).toMatchObject({ status: 200, body: { v: 1, lcs: 87 } });
    expect(r.type).toMatch(/application\/json/);
    expect((await call(`/api/passports/b${"a".repeat(40)}`)).status).toBe(404);
    expect((await call("/api/passports/nope")).status).toBe(400);
  });
});
