import type { LedgerService, LoanSnapshot } from "@hack/ledger";
import { Alert, type Decision } from "@hack/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createApplication, isBanned, listAudit, loansPaidOff, openDb, transition, type Db } from "../db/db";
import { createMonitor } from "./monitor";

const ALICE = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb";
const CAROL = "rnfZk26oqAJ9vAp2eN6p8JysktcVp3VmoW";
const LOAN_A = "A".repeat(64), LOAN_C = "C".repeat(64);
const DUE = "2026-10-24T22:31:40.000Z";
const before = new Date("2026-10-24T22:31:00.000Z"), after = new Date("2026-10-24T22:32:00.000Z"), later = new Date("2026-10-24T22:33:00.000Z");

const decision: Decision = {
  approved: true, sanctions: { blocked: false }, facts: null, featureSource: null, score: null, minScore: 50,
  interestRate: 10000, reasons: ["ok"], explanation: "x", explanationSource: "template",
};
const snapshot = (loanId: string, borrower: string, over: Partial<LoanSnapshot> = {}): LoanSnapshot => ({
  loanId, borrower, principal: "500", interestRate: 10000, paymentsRemaining: 3, nextDueIso: DUE, totalOwed: "510",
  status: "active", installmentDue: "177", payoffAmount: "511", canImpair: false, canDefault: false, ...over,
});

let db: Db;
let loans: Record<string, LoanSnapshot | undefined>;
let reads: number;
const ledger = {
  getLoan: async (id: string) => { reads++; const l = loans[id]; if (!l) throw new Error("entryNotFound"); return l; },
} as unknown as LedgerService;

const originate = (borrower: string, loanId: string) => {
  const a = createApplication(db, { borrowerAddress: borrower, amount: "500", paymentTotal: 3, status: "pending_review", decision });
  transition(db, a.id, ["pending_review"], "originating");
  transition(db, a.id, ["originating"], "active", { loanId });
};

beforeEach(() => {
  db = openDb(":memory:");
  reads = 0;
  loans = { [LOAN_A]: snapshot(LOAN_A, ALICE), [LOAN_C]: snapshot(LOAN_C, CAROL, { nextDueIso: "2026-10-24T23:00:00.000Z" }) };
  originate(ALICE, LOAN_A);
  originate(CAROL, LOAN_C);
});

describe("overdue monitor", () => {
  it("raises nothing before the due date", async () => {
    const m = createMonitor({ db, ledger });
    await m.tick(before);
    expect(m.alerts()).toEqual([]);
  });

  it("raises an overdue alert in the contract shape once the due date passes, only for late loans", async () => {
    const m = createMonitor({ db, ledger });
    await m.tick(after);
    const [alert] = m.alerts();
    expect(Alert.parse(alert)).toEqual({ loanId: LOAN_A, borrower: ALICE, kind: "overdue", nextDueIso: DUE, detectedAt: after.toISOString() });
    expect(m.alerts()).toHaveLength(1); // Carol is not due yet
  });

  it("keeps the first detection time on later ticks", async () => {
    const m = createMonitor({ db, ledger });
    await m.tick(after);
    await m.tick(later);
    expect(m.alerts()[0].detectedAt).toBe(after.toISOString());
  });

  it("clears the alert once the borrower catches up", async () => {
    const m = createMonitor({ db, ledger });
    await m.tick(after);
    loans[LOAN_A] = snapshot(LOAN_A, ALICE, { nextDueIso: "2026-10-24T22:40:00.000Z" }); // paid the installment
    await m.tick(later);
    expect(m.alerts()).toEqual([]);
  });

  it("records loans that ended outside our routes and stops watching them", async () => {
    const m = createMonitor({ db, ledger });
    loans[LOAN_A] = snapshot(LOAN_A, ALICE, { status: "defaulted", nextDueIso: null });
    loans[LOAN_C] = snapshot(LOAN_C, CAROL, { status: "paid", nextDueIso: null });
    await m.tick(later);
    expect(isBanned(db, ALICE)).toBe(true);
    expect(loansPaidOff(db, CAROL)).toBe(1);
    reads = 0;
    await m.tick(later);
    expect(reads).toBe(0); // both ended, so the next tick reads nothing
  });

  it("skips a loan the ledger cannot find and keeps going", async () => {
    loans[LOAN_A] = undefined;
    loans[LOAN_C] = snapshot(LOAN_C, CAROL, { nextDueIso: DUE });
    const m = createMonitor({ db, ledger });
    await m.tick(after);
    expect(m.alerts().map((a) => a.borrower)).toEqual([CAROL]);
  });

  it("does not start a second check while one is still running", async () => {
    let release!: () => void;
    const slow = { getLoan: async (id: string) => { reads++; await new Promise<void>((r) => (release = r)); return loans[id]!; } } as unknown as LedgerService;
    const m = createMonitor({ db, ledger: slow });
    const first = m.tick(after);
    await m.tick(after); // returns at once: the first is still waiting
    expect(reads).toBe(1);
    release();
    await new Promise((r) => setTimeout(r, 0));
    release();
    await first;
  });
  it("writes one payment_overdue audit row per loan, not one per tick", async () => {
    const m = createMonitor({ db, ledger });
    await m.tick(after);
    await m.tick(later);
    expect(listAudit(db).filter((e) => e.action === "payment_overdue").map((e) => e.loanId)).toEqual([LOAN_A]);
  });

  it("keeps an alert through a failed ledger read", async () => {
    const m = createMonitor({ db, ledger });
    await m.tick(after);
    loans[LOAN_A] = undefined; // the read fails this tick
    await m.tick(later);
    expect(m.alerts().map((a) => a.loanId)).toEqual([LOAN_A]);
  });
});
