import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { LedgerService, LoanSnapshot } from "@hack/ledger";
import { AgentView, BrokerView, RevenueView, type Decision } from "@hack/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createApplication, listApplications, listPayments, openDb, transition, type Db } from "../db/db";
import { placeholderUnderwrite } from "../services/underwriting";

const KEY = "test-broker-key-123";
const ALICE = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb";
const LOAN = "A".repeat(64);
const tx = (c: string) => ({ hash: c.repeat(64), result: "tesSUCCESS", explorerUrl: `https://devnet.xrpl.org/transactions/${c.repeat(64)}` });

let db: Db, server: Server, base: string;
let broker: { debtTotal: string; coverAvailable: string };
let principal: string;
let delegationTx: ReturnType<typeof tx> | null;

const fakeLedger = {
  getWallets: () => [{ role: "alice", label: "Alice", address: ALICE }],
  getBroker: async () => ({
    loanBrokerId: "9".repeat(64), ...broker, coverRateMinimum: 10000, coverRateLiquidation: 10000, managementFeeRate: 10000,
  }),
  depositCover: async () => tx("1"),
  withdrawCover: async () => tx("2"),
  getLoan: async (): Promise<LoanSnapshot> => ({
    loanId: LOAN, borrower: ALICE, principal, interestRate: 10000, paymentsRemaining: 2, nextDueIso: null, totalOwed: principal,
    status: "active", installmentDue: "177", payoffAmount: "344", canImpair: false, canDefault: false,
  }),
  // Like the live Devnet loan: 177 paid, principal 500 -> 334, so 11 is interest + the 10 service fee.
  payLoan: async () => { principal = "334"; return { tx: tx("3"), amount: "177" }; },
  setAgentDelegation: async () => delegationTx,
} as unknown as LedgerService;

const decision: Decision = {
  approved: true, sanctions: { blocked: false }, facts: null, featureSource: null, score: null, minScore: 50,
  interestRate: 10000, reasons: ["ok"], explanation: "x", explanationSource: "template",
};

beforeEach(() => {
  process.env.BROKER_KEY = KEY;
  process.env.DEMO_MODE = "true";
  db = openDb(":memory:");
  broker = { debtTotal: "500", coverAvailable: "1000" };
  principal = "500";
  delegationTx = null;
  server = createApp({ db, ledger: fakeLedger, underwrite: placeholderUnderwrite }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => server.close());

const call = async (path: string, init: { method?: string; body?: unknown; key?: boolean } = {}) => {
  const res = await fetch(base + path, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.key === false ? {} : { "x-broker-key": KEY }) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: await res.json() };
};

describe("broker", () => {
  it("is behind the broker key", async () => {
    expect((await call("/api/broker", { key: false })).status).toBe(401);
    expect((await call("/api/broker/audit", { key: false })).status).toBe(401);
  });

  it("reports cover health: 10% of 500 debt is 50, and 1000 cover is healthy", async () => {
    expect(BrokerView.parse((await call("/api/broker")).body)).toMatchObject({ coverRequired: "50", coverHealthy: true });
    broker = { debtTotal: "20000", coverAvailable: "1000" };
    expect((await call("/api/broker")).body).toMatchObject({ coverRequired: "2000", coverHealthy: false });
  });

  it("moves cover and logs it", async () => {
    expect((await call("/api/broker/cover/deposit", { method: "POST", body: { amount: "100" } })).body.result).toBe("tesSUCCESS");
    expect((await call("/api/broker/audit")).body[0]).toMatchObject({ actor: "broker", action: "cover_deposit", note: "100" });
  });
});

describe("revenue (R10)", () => {
  it("splits each payment into principal, interest and the service fee, and totals them", async () => {
    const a = createApplication(db, { borrowerAddress: ALICE, amount: "500", paymentTotal: 3, status: "pending_review", decision });
    transition(db, a.id, ["pending_review"], "originating");
    transition(db, a.id, ["originating"], "active", { loanId: LOAN, tx: tx("9") });

    await call(`/api/loans/${LOAN}/pay-due`, { method: "POST", key: false });
    const [p] = listPayments(db);
    expect(p).toMatchObject({ principal_paid: "166", interest: "1", service_fee: "10" });

    const r = RevenueView.parse((await call("/api/broker/revenue")).body);
    expect(r).toEqual({
      interestCollected: "1.00", platformFees: "0.10", depositorShare: "0.90", paymentsCount: 1,
      managementFeeRate: 10000, serviceFees: "10.00", originationFees: "100.00",
    });
  });
});

describe("agent", () => {
  it("shows its state and lets the broker pause, resume and set the pass mark", async () => {
    expect(AgentView.parse((await call("/api/agent", { key: false })).body)).toEqual({ paused: false, policy: { minScore: 50 }, delegationEnabled: false });
    expect((await call("/api/agent/pause", { method: "POST" })).body.paused).toBe(true);
    const blocked = await call("/api/applications", { method: "POST", key: false, body: { borrowerAddress: ALICE, amount: "100", paymentTotal: 1 } });
    expect(blocked.status).toBe(409);
    expect((await call("/api/agent/resume", { method: "POST" })).body.paused).toBe(false);
    expect((await call("/api/agent/policy", { method: "POST", body: { minScore: 70 } })).body.policy.minScore).toBe(70);
  });

  it("passes the broker's pass mark to underwriting", async () => {
    await call("/api/agent/policy", { method: "POST", body: { minScore: 65 } });
    const r = await call("/api/applications", { method: "POST", key: false, body: { borrowerAddress: ALICE, amount: "100", paymentTotal: 1 } });
    expect(r.body.decision.minScore).toBe(65);
  });

  it("needs the broker key to change anything, and rejects a pass mark above 100", async () => {
    expect((await call("/api/agent/pause", { method: "POST", key: false })).status).toBe(401);
    expect((await call("/api/agent/policy", { method: "POST", body: { minScore: 150 } })).status).toBe(400);
  });

  it("leaves delegation off while the ledger has no multi-sign (Feature 3)", async () => {
    expect((await call("/api/agent/delegation", { method: "POST", body: { enabled: true } })).body).toBeNull();
    expect((await call("/api/agent", { key: false })).body.delegationEnabled).toBe(false);
    delegationTx = tx("4");
    await call("/api/agent/delegation", { method: "POST", body: { enabled: true } });
    expect((await call("/api/agent", { key: false })).body.delegationEnabled).toBe(true);
  });
});

describe("demo reset (R12)", () => {
  it("clears the database with the broker key and DEMO_MODE=true", async () => {
    await call("/api/applications", { method: "POST", key: false, body: { borrowerAddress: ALICE, amount: "100", paymentTotal: 1 } });
    expect((await call("/api/demo/reset", { method: "DELETE" })).body).toEqual({ ok: true });
    expect(listApplications(db)).toHaveLength(0);
    expect((await call("/api/broker/audit")).body.map((e: { action: string }) => e.action)).toEqual(["demo_reset"]);
  });

  it("is refused without DEMO_MODE=true or without the key", async () => {
    expect((await call("/api/demo/reset", { method: "DELETE", key: false })).status).toBe(401);
    process.env.DEMO_MODE = "false";
    expect((await call("/api/demo/reset", { method: "DELETE" })).status).toBe(403);
  });
});
