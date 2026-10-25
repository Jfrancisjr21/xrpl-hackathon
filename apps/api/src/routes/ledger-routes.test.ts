import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { LedgerService, LoanSnapshot } from "@hack/ledger";
import { LoanView, PayResult, VaultView, type Decision } from "@hack/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { testUnderwrite } from "./test-underwrite";
import { createApplication, isBanned, listAudit, listPayments, loansPaidOff, openDb, transition, type Db } from "../db/db";

const KEY = "test-broker-key-123";
const ALICE = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb";
const DEPOSITOR = "rhQfme96j81aru3i6rFsYEexx5NP7LBe98";
const LOAN = "A".repeat(64);
const GONE = "B".repeat(64);
const tx = (c: string) => ({ hash: c.repeat(64), result: "tesSUCCESS", explorerUrl: `https://devnet.xrpl.org/transactions/${c.repeat(64)}` });

const vault = {
  vaultId: "E".repeat(64), assetLabel: "TSTUSD", assetsTotal: "10000", assetsAvailable: "9500", lossUnrealized: "0",
  utilizationPct: 5, phase: "investment" as const, subscriptionDate: "2026-10-24T22:30:20.000Z", redemptionDate: "2026-10-25T00:30:20.000Z",
};
const snapshot = (over: Partial<LoanSnapshot> = {}): LoanSnapshot => ({
  loanId: LOAN, borrower: ALICE, principal: "500", interestRate: 10000, paymentsRemaining: 3,
  nextDueIso: "2099-01-01T00:00:00.000Z", totalOwed: "510", status: "active",
  installmentDue: "180", payoffAmount: "520", canImpair: false, canDefault: false, ...over,
});

let db: Db, server: Server, base: string;
let loan: LoanSnapshot;
let calls: string[];

const fakeLedger = {
  getWallets: () => [{ role: "depositor", label: "Depositor", address: DEPOSITOR }, { role: "alice", label: "Alice", address: ALICE }],
  getVault: async () => vault,
  getPosition: async (address: string) => ({ address, deposited: "10000", sharePct: 100 }),
  deposit: async () => { calls.push("deposit"); return tx("1"); },
  withdraw: async () => { throw new Error("VaultWithdraw failed with tecTOO_SOON"); },
  getLoan: async (id: string) => { if (id === GONE) throw new Error("entryNotFound"); return loan; },
  payLoan: async (_id: string, mode: string) => {
    calls.push(`pay:${mode}`);
    if (mode === "payoff") loan = snapshot({ status: "paid", paymentsRemaining: 0 });
    return { tx: tx("2"), amount: mode === "payoff" ? "520" : "180" };
  },
  manageLoan: async (_id: string, action: string) => { calls.push(action); return tx("3"); },
} as unknown as LedgerService;

const decision: Decision = {
  approved: true, sanctions: { blocked: false }, facts: null, featureSource: null, score: null, minScore: 50,
  interestRate: 10000, reasons: ["ok"], explanation: "x", explanationSource: "template",
};
// An active application whose loan is on the (fake) ledger.
const originated = (loanId = LOAN) => {
  const a = createApplication(db, { borrowerAddress: ALICE, amount: "500", paymentTotal: 3, status: "pending_review", decision });
  transition(db, a.id, ["pending_review"], "originating");
  return transition(db, a.id, ["originating"], "active", { loanId, tx: tx("9") })!;
};

beforeEach(() => {
  process.env.BROKER_KEY = KEY;
  db = openDb(":memory:");
  loan = snapshot();
  calls = [];
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
  return { status: res.status, body: await res.json() };
};

describe("vault", () => {
  it("returns the vault, with a wallet's position when ?address= is given", async () => {
    expect(VaultView.parse((await call("/api/vault")).body).position).toBeUndefined();
    const r = await call(`/api/vault?address=${DEPOSITOR}`);
    expect(VaultView.parse(r.body).position).toEqual({ address: DEPOSITOR, deposited: "10000", sharePct: 100 });
  });

  it("deposits for a demo wallet and logs it", async () => {
    const r = await call("/api/vault/deposit", { method: "POST", body: { address: DEPOSITOR, amount: "500" } });
    expect(r.body.result).toBe("tesSUCCESS");
    expect(listAudit(db)[0]).toMatchObject({ actor: "depositor", action: "vault_deposit" });
  });

  it("refuses unknown wallets and decimal amounts before touching the ledger", async () => {
    expect((await call("/api/vault/deposit", { method: "POST", body: { address: "rnXyVQzgxZe7TR1EPzTkGj2jxH4LMJYh66", amount: "5" } })).status).toBe(400);
    expect((await call("/api/vault/deposit", { method: "POST", body: { address: DEPOSITOR, amount: "5.5" } })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("passes a ledger refusal through as 502 (e.g. withdrawing before the redemption date)", async () => {
    const r = await call("/api/vault/withdraw", { method: "POST", body: { address: DEPOSITOR, amount: "5" } });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/tecTOO_SOON/);
  });
});

describe("loans list", () => {
  it("returns our loans as LoanView with the application id", async () => {
    const a = originated();
    const [l] = (await call("/api/loans")).body;
    expect(LoanView.parse(l)).toMatchObject({ loanId: LOAN, applicationId: a.id, status: "active", installmentDue: "180" });
  });

  it("skips a loan the ledger no longer knows instead of failing the list (R2)", async () => {
    originated(GONE);
    expect(await call("/api/loans")).toEqual({ status: 200, body: [] });
  });
});

describe("paying", () => {
  it("pay-due pays one installment and records the payment (R3, R10)", async () => {
    originated();
    const r = await call(`/api/loans/${LOAN}/pay-due`, { method: "POST" });
    expect(PayResult.parse(r.body).amount).toBe("180");
    expect(calls).toEqual(["pay:installment"]);
    expect(listPayments(db)).toMatchObject([{ loan_id: LOAN, mode: "installment", amount: "180" }]);
  });

  it("a payoff closes the loan, counts toward history and frees the borrower to apply again", async () => {
    originated();
    await call(`/api/loans/${LOAN}/pay`, { method: "POST", body: { mode: "payoff" } });
    expect(loansPaidOff(db, ALICE)).toBe(1);
    const again = await call("/api/applications", { method: "POST", body: { borrowerAddress: ALICE, amount: "100", paymentTotal: 1 } });
    expect(again.status).toBe(201);
    expect((await call(`/api/loans/${LOAN}/pay-due`, { method: "POST" })).status).toBe(409); // already paid
  });

  it("refuses a payoff while a payment is overdue, before touching the ledger", async () => {
    originated();
    loan = snapshot({ nextDueIso: "2020-01-01T00:00:00.000Z" });
    const r = await call(`/api/loans/${LOAN}/pay`, { method: "POST", body: { mode: "payoff" } });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Pay the amount due first/);
    expect(calls).toEqual([]);
  });

  it("answers 404 for a loan we did not originate, and 400 for a malformed id", async () => {
    expect((await call(`/api/loans/${"F".repeat(64)}/pay-due`, { method: "POST" })).status).toBe(404);
    expect((await call("/api/loans/123/pay-due", { method: "POST" })).status).toBe(400);
  });
});

describe("impair and default", () => {
  it("need the broker key", async () => {
    originated();
    expect((await call(`/api/loans/${LOAN}/impair`, { method: "POST" })).status).toBe(401);
  });

  it("refuse with 409 until the ledger allows them", async () => {
    originated();
    expect((await call(`/api/loans/${LOAN}/impair`, { method: "POST", key: true })).body.error).toMatch(/no payment is late/);
    expect((await call(`/api/loans/${LOAN}/default`, { method: "POST", key: true })).body.error).toMatch(/grace period/);
    expect(calls).toEqual([]);
  });

  it("impair once a payment is late", async () => {
    originated();
    loan = snapshot({ canImpair: true });
    expect((await call(`/api/loans/${LOAN}/impair`, { method: "POST", key: true })).body.result).toBe("tesSUCCESS");
    expect(calls).toEqual(["impair"]);
  });

  it("default after the grace period bans the borrower", async () => {
    originated();
    loan = snapshot({ status: "impaired", canDefault: true });
    expect((await call(`/api/loans/${LOAN}/default`, { method: "POST", key: true })).status).toBe(200);
    expect(isBanned(db, ALICE)).toBe(true);
    expect(listAudit(db)[0]).toMatchObject({ action: "loan_defaulted", note: `${ALICE} added to the ban list` });
    const again = await call("/api/applications", { method: "POST", body: { borrowerAddress: ALICE, amount: "100", paymentTotal: 1 } });
    expect(again.body).toMatchObject({ status: "denied", decision: { reasons: ["Address is on the ban list after a defaulted loan with us"] } });
  });
});
