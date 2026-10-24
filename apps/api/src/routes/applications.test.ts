import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ApplicationView, DemoWallet, ErrorResponse, HealthResponse, type Decision } from "@hack/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { openDb, setConfig, type Db } from "../db/db";
import { LedgerNotReadyError, type LedgerService, type LoanTerms } from "@hack/ledger";
import type { Underwrite } from "../services/underwriting";

const KEY = "test-broker-key-123";
const ALICE = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb";
const BOB = "rGgZFNrAko9bofdegqwMq2TxLVyXJnUn95";
const STRANGER = "rnXyVQzgxZe7TR1EPzTkGj2jxH4LMJYh66";

// Only what these routes call; any other method would throw if a route used it by mistake.
const fakeLedger = {
  getWallets: () => [
    { role: "alice", label: "Alice", address: ALICE, description: "Strong profile" },
    { role: "bob", label: "Bob", address: BOB },
  ],
  getVault: async () => ({ phase: "subscription" }),
  originateLoan: (t: LoanTerms) => originate(t),
} as unknown as LedgerService;

// What the fake ledger does on originateLoan; each test sets it.
const LOAN_ID = "C".repeat(64);
const TX = { hash: "D".repeat(64), result: "tesSUCCESS", explorerUrl: `https://devnet.xrpl.org/transactions/${"D".repeat(64)}` };
let originate: (t: LoanTerms) => Promise<{ loanId: string; tx: typeof TX }>;
let lastTerms: LoanTerms | undefined;
const decision = (approved: boolean): Decision => ({
  approved, sanctions: { blocked: false }, facts: null, featureSource: null, score: null, minScore: 50,
  interestRate: approved ? 7400 : null, reasons: [approved ? "ok" : "no"], explanation: "x", explanationSource: "template",
});
// Alice is approved, Bob is denied.
const fakeUnderwrite: Underwrite = async (input) => decision(input.borrowerAddress === ALICE);

let db: Db, server: Server, base: string, underwriteCalls: number;
beforeEach(() => {
  process.env.BROKER_KEY = KEY;
  process.env.XRPL_URL = "wss://s.devnet.rippletest.net:51233";
  db = openDb(":memory:");
  underwriteCalls = 0;
  lastTerms = undefined;
  process.env.DEMO_FAST_LOANS = "true";
  originate = async (t) => { lastTerms = t; return { loanId: LOAN_ID, tx: TX }; };
  const counted: Underwrite = (i) => { underwriteCalls++; return fakeUnderwrite(i); };
  server = createApp({ db, ledger: fakeLedger, underwrite: counted }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => server.close());

const call = async (path: string, init: { method?: string; body?: unknown; key?: string } = {}) => {
  const res = await fetch(base + path, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.key ? { "x-broker-key": init.key } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: await res.json() };
};
const apply = (address = ALICE) => call("/api/applications", { method: "POST", body: { borrowerAddress: address, amount: "500", paymentTotal: 3 } });

describe("health and wallets", () => {
  it("reports health in the contract shape", async () => {
    const r = await call("/api/health");
    expect(HealthResponse.parse(r.body)).toEqual({ ok: true, mockMode: false, network: "devnet", vaultPhase: "subscription" });
  });

  it("lists the demo wallets with descriptions (R13)", async () => {
    const r = await call("/api/wallets");
    expect(r.body.map((w: unknown) => DemoWallet.parse(w).label)).toEqual(["Alice", "Bob"]);
  });
});

describe("POST /api/applications", () => {
  it("creates an approved application in pending_review with a decision hash", async () => {
    const r = await apply();
    expect(r.status).toBe(201);
    const view = ApplicationView.parse(r.body);
    expect(view).toMatchObject({ id: 1, status: "pending_review", amount: "500" });
    expect(view.decisionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores a denial as final", async () => {
    expect((await apply(BOB)).body.status).toBe("denied");
  });

  it("refuses a second open application with 409, without underwriting again (R11)", async () => {
    await apply();
    const r = await apply();
    expect(r.status).toBe(409);
    expect(ErrorResponse.parse(r.body).error).toMatch(/already has an application/);
    expect(underwriteCalls).toBe(1);
  });

  it("lets a denied borrower apply again", async () => {
    await apply(BOB);
    expect((await apply(BOB)).status).toBe(201);
  });

  it("only accepts demo wallets", async () => {
    const r = await apply(STRANGER);
    expect(r.status).toBe(400);
    expect(r.body.fields.borrowerAddress).toMatch(/demo wallets/);
  });

  it("answers 400 per field for bad input", async () => {
    const r = await call("/api/applications", { method: "POST", body: { borrowerAddress: ALICE, amount: "10.5", paymentTotal: 30 } });
    expect(Object.keys(r.body.fields).sort()).toEqual(["amount", "paymentTotal"]);
  });

  it("refuses new applications while the agent is paused", async () => {
    setConfig(db, "paused", "true");
    expect((await apply()).status).toBe(409);
  });
});

describe("GET /api/applications", () => {
  it("lists newest first and filters by status and borrower", async () => {
    await apply(BOB);
    await apply();
    expect((await call("/api/applications")).body.map((a: { id: number }) => a.id)).toEqual([2, 1]);
    expect((await call("/api/applications?status=denied")).body).toHaveLength(1);
    expect((await call(`/api/applications?borrower=${ALICE}`)).body).toHaveLength(1);
    expect((await call("/api/applications?status=closed")).status).toBe(400);
  });

  it("gets one by id, or 404", async () => {
    await apply();
    expect((await call("/api/applications/1")).body.id).toBe(1);
    expect((await call("/api/applications/99")).status).toBe(404);
  });
});

describe("POST /api/applications/:id/reject", () => {
  it("needs the broker key", async () => {
    await apply();
    expect((await call("/api/applications/1/reject", { method: "POST", body: { note: "no" } })).status).toBe(401);
  });

  it("rejects a pending application with the broker's note and logs it", async () => {
    await apply();
    const r = await call("/api/applications/1/reject", { method: "POST", key: KEY, body: { note: "Amount too high for now" } });
    expect(r.body).toMatchObject({ status: "rejected", brokerNote: "Amount too high for now" });
  });

  it("answers 409 for anything not pending_review, and 400 for a blank note", async () => {
    await apply(BOB); // denied
    expect((await call("/api/applications/1/reject", { method: "POST", key: KEY, body: { note: "no" } })).status).toBe(409);
    await apply();
    expect((await call("/api/applications/2/reject", { method: "POST", key: KEY, body: { note: "   " } })).status).toBe(400);
  });
});

describe("POST /api/applications/:id/approve", () => {
  const approve = (id = 1) => call(`/api/applications/${id}/approve`, { method: "POST", key: KEY });

  it("needs the broker key", async () => {
    await apply();
    expect((await call("/api/applications/1/approve", { method: "POST" })).status).toBe(401);
  });

  it("originates the loan and makes the application active, with the decision hash as the memo", async () => {
    const created = (await apply()).body;
    const r = await approve();
    expect(r.status).toBe(200);
    expect(ApplicationView.parse(r.body)).toMatchObject({ status: "active", loanId: LOAN_ID, tx: TX });
    expect(lastTerms).toEqual({
      borrower: ALICE, principal: "500", interestRate: 7400, paymentTotal: 3,
      paymentIntervalSec: 60, gracePeriodSec: 60, decisionMemo: created.decisionHash,
    });
  });

  it("uses 30-day payments when DEMO_FAST_LOANS is off", async () => {
    process.env.DEMO_FAST_LOANS = "false";
    await apply();
    await approve();
    expect(lastTerms?.paymentIntervalSec).toBe(30 * 24 * 60 * 60);
  });

  it("answers 409 with opensAt during the deposit window, and leaves the application approvable", async () => {
    originate = async () => { throw new LedgerNotReadyError("Loans open when the deposit window closes", "2026-10-24T22:30:20.000Z"); };
    await apply();
    const r = await approve();
    expect(r).toEqual({ status: 409, body: { error: "Loans open when the deposit window closes", opensAt: "2026-10-24T22:30:20.000Z" } });
    expect((await call("/api/applications/1")).body.status).toBe("pending_review");
  });

  it("marks the application failed with the reason when the ledger refuses (502)", async () => {
    originate = async () => { throw new Error("LoanSet failed with tecINSUFFICIENT_FUNDS"); };
    await apply();
    const r = await approve();
    expect(r.status).toBe(502);
    expect((await call("/api/applications/1")).body).toMatchObject({ status: "failed", error: "LoanSet failed with tecINSUFFICIENT_FUNDS" });
  });

  it("never originates twice, even when two approvals arrive together", async () => {
    let calls = 0;
    originate = async (t) => { calls++; await new Promise((r) => setTimeout(r, 50)); lastTerms = t; return { loanId: LOAN_ID, tx: TX }; };
    await apply();
    const [a, b] = await Promise.all([approve(), approve()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(calls).toBe(1);
  });

  it("refuses denied, rejected or unknown applications", async () => {
    await apply(BOB); // denied
    expect((await approve(1)).status).toBe(409);
    expect((await approve(99)).status).toBe(404);
  });
});
