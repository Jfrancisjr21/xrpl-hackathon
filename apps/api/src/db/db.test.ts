import { ApplicationView, AuditEvent, type Decision } from "@hack/shared";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  audit, closeLoan, createApplication, getConfig, isBanned, listApplications, listAudit, listPayments,
  loansPaidOff, OpenApplicationError, openDb, recordPayment, resetAll, setConfig, toView, transition, type Db,
} from "./db";

const ALICE = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb";
const LOAN = "C".repeat(64);
const TX = { hash: "D".repeat(64), result: "tesSUCCESS", explorerUrl: `https://devnet.xrpl.org/transactions/${"D".repeat(64)}` };
const decision: Decision = {
  approved: true, sanctions: { blocked: false }, facts: null, featureSource: null, score: null,
  minScore: 50, interestRate: 7400, reasons: ["ok"], explanation: "Approved.", explanationSource: "template",
};
const apply = (db: Db, status: "pending_review" | "denied" = "pending_review") =>
  createApplication(db, { borrowerAddress: ALICE, amount: "500", paymentTotal: 3, status, decision });

let db: Db;
beforeEach(() => { db = openDb(":memory:"); });

describe("applications", () => {
  it("round-trips into a valid ApplicationView with ISO dates (R15)", () => {
    const view = toView(apply(db));
    expect(ApplicationView.safeParse(view).success).toBe(true);
    expect(view.createdAt).toBe(new Date(view.createdAt).toISOString());
  });

  it("allows only one open application per borrower (R11)", () => {
    apply(db);
    expect(() => apply(db)).toThrow(OpenApplicationError);
  });

  it("lets a borrower apply again after a denial or a closed-out application", () => {
    apply(db, "denied");
    const open = apply(db);
    transition(db, open.id, ["pending_review"], "rejected", { brokerNote: "no" });
    expect(() => apply(db)).not.toThrow();
  });

  it("only moves an application from the expected state, so a double approve gets nothing", () => {
    const a = apply(db);
    expect(transition(db, a.id, ["pending_review"], "originating")?.status).toBe("originating");
    expect(transition(db, a.id, ["pending_review"], "originating")).toBeUndefined();
  });

  it("stores the loan id and tx once originated, and never the same loan twice", () => {
    const a = apply(db);
    transition(db, a.id, ["pending_review"], "originating");
    const active = transition(db, a.id, ["originating"], "active", { loanId: LOAN, tx: TX })!;
    expect(toView(active)).toMatchObject({ status: "active", loanId: LOAN, tx: TX });
    const other = createApplication(db, { borrowerAddress: "rnfZk26oqAJ9vAp2eN6p8JysktcVp3VmoW", amount: "1", paymentTotal: 1, status: "pending_review", decision });
    transition(db, other.id, ["pending_review"], "originating");
    expect(() => transition(db, other.id, ["originating"], "active", { loanId: LOAN })).toThrow(/UNIQUE/);
  });

  it("filters the list by status and borrower", () => {
    apply(db, "denied");
    apply(db);
    expect(listApplications(db, { status: "denied" })).toHaveLength(1);
    expect(listApplications(db, { borrower: ALICE })).toHaveLength(2);
    expect(listApplications(db)[0].status).toBe("pending_review"); // newest first
  });
});

describe("loan outcomes, history and the ban list", () => {
  const originate = () => {
    const a = apply(db);
    transition(db, a.id, ["pending_review"], "originating");
    return transition(db, a.id, ["originating"], "active", { loanId: LOAN, tx: TX })!;
  };

  it("counts loans paid off with us for the internal score", () => {
    originate();
    expect(loansPaidOff(db, ALICE)).toBe(0);
    closeLoan(db, LOAN, "paid");
    expect(loansPaidOff(db, ALICE)).toBe(1);
    expect(isBanned(db, ALICE)).toBe(false);
  });

  it("bans a borrower whose loan defaulted", () => {
    originate();
    closeLoan(db, LOAN, "defaulted");
    expect(isBanned(db, ALICE)).toBe(true);
    expect(loansPaidOff(db, ALICE)).toBe(0);
  });
});

describe("payments, audit, config and reset", () => {
  it("records payments (R10) and audit events with ISO times", () => {
    const a = apply(db);
    recordPayment(db, { loanId: LOAN, applicationId: a.id, mode: "installment", amount: "180", txHash: TX.hash });
    expect(listPayments(db)).toMatchObject([{ mode: "installment", amount: "180" }]);
    audit(db, { actor: "broker", action: "application_approved", applicationId: a.id, tx: TX });
    const [event] = listAudit(db);
    expect(AuditEvent.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({ actor: "broker", action: "application_approved", applicationId: a.id, tx: TX });
  });

  it("keeps broker settings", () => {
    setConfig(db, "minScore", "50");
    setConfig(db, "minScore", "60");
    expect(getConfig(db, "minScore")).toBe("60");
  });

  it("clears everything for a demo run (R12)", () => {
    apply(db);
    setConfig(db, "paused", "true");
    resetAll(db);
    expect(listApplications(db)).toHaveLength(0);
    expect(getConfig(db, "paused")).toBeUndefined();
    expect(apply(db).id).toBe(1); // ids restart
  });

  it("can be opened twice on the same file without losing data", () => {
    const file = join(tmpdir(), `api-db-test-${process.pid}.db`);
    const first = openDb(file);
    createApplication(first, { borrowerAddress: ALICE, amount: "1", paymentTotal: 1, status: "denied", decision });
    first.close();
    const second = openDb(file);
    expect(listApplications(second)).toHaveLength(1);
    second.close();
    rmSync(file, { force: true });
  });
});
