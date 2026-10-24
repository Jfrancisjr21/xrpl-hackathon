import {
  LoanManageFlags, LoanPayFlags, convertStringToHex, decode, rippleTimeToUnixTime, signLoanSetByCounterparty,
  type Client, type Wallet,
} from "xrpl";
import { serial, submit, checkResult, findCreated, ledgerCloseTime, ledgerEntry } from "./client";
import type { LoanSnapshot, LoanStatus, LoanTerms, PayMode } from "./types";

export const ORIGINATION_FEE = "100"; // taken from the principal, paid to the broker
export const SERVICE_FEE = "10";     // added to every payment

export function buildLoanSet(brokerAddr: string, loanBrokerId: string, t: LoanTerms) {
  return {
    TransactionType: "LoanSet",
    Account: brokerAddr,
    Counterparty: t.borrower,
    LoanBrokerID: loanBrokerId,
    PrincipalRequested: t.principal,
    InterestRate: t.interestRate,
    PaymentTotal: t.paymentTotal,
    PaymentInterval: t.paymentIntervalSec,
    ...(t.gracePeriodSec > 0 ? { GracePeriod: t.gracePeriodSec } : {}),
    LoanOriginationFee: ORIGINATION_FEE,
    LoanServiceFee: SERVICE_FEE,
    // Feature 1: the decision hash travels with the loan, readable on the explorer.
    ...(t.decisionMemo
      ? { Memos: [{ Memo: { MemoType: convertStringToHex("decision-sha256"), MemoData: t.decisionMemo.toUpperCase() } }] }
      : {}),
  };
}

export function originate(c: Client, broker: Wallet, borrower: Wallet, loanBrokerId: string, t: LoanTerms) {
  return serial(async () => {
    const tx: any = await c.autofill(buildLoanSet(broker.address, loanBrokerId, t) as any);
    const brokerSigned = broker.sign(tx);
    const fullySigned: any = signLoanSetByCounterparty(borrower, decode(brokerSigned.tx_blob) as any);
    const r = checkResult("LoanSet", await c.submitAndWait(fullySigned.tx));
    return { ...r, loanId: findCreated(r.meta, "Loan").LedgerIndex };
  });
}

export const loanEntry = (c: Client, loanId: string) => ledgerEntry(c, loanId);

// MPT amounts are whole numbers, so round amounts owed up.
const up = (v: unknown) => Math.ceil(Number(v ?? 0));
export const installmentAmount = (e: any) => String(up(e.PeriodicPayment) + up(e.LoanServiceFee));
export const payoffAmount = (e: any) => String(up(e.TotalValueOutstanding) + up(e.LoanServiceFee));

export function loanStatus(e: any): LoanStatus {
  const f: number = e.Flags ?? 0;
  if (f & LoanManageFlags.tfLoanDefault) return "defaulted";
  if (f & LoanManageFlags.tfLoanImpair) return "impaired";
  if (!e.TotalValueOutstanding || Number(e.TotalValueOutstanding) === 0) return "paid";
  return "active";
}

export async function payLoan(c: Client, borrower: Wallet, loanId: string, mptId: string, mode: PayMode) {
  const [e, now] = await Promise.all([loanEntry(c, loanId), ledgerCloseTime(c)]);
  if (loanStatus(e) === "paid") throw new Error("Loan is already paid off");
  const value = mode === "payoff" ? payoffAmount(e) : installmentAmount(e);
  const late = mode === "installment" && now > e.NextPaymentDueDate;
  const tx = await submit(c, borrower, {
    TransactionType: "LoanPay", Account: borrower.address, LoanID: loanId,
    Amount: { mpt_issuance_id: mptId, value },
    ...(late ? { Flags: LoanPayFlags.tfLoanLatePayment } : {}),
  });
  return { tx, amount: value };
}

// Only the LoanBroker owner can impair, unimpair or default.
export function manageLoan(c: Client, broker: Wallet, loanId: string, action: "impair" | "unimpair" | "default") {
  const flag =
    action === "impair" ? LoanManageFlags.tfLoanImpair :
    action === "unimpair" ? LoanManageFlags.tfLoanUnimpair :
    LoanManageFlags.tfLoanDefault;
  return submit(c, broker, { TransactionType: "LoanManage", Account: broker.address, LoanID: loanId, Flags: flag });
}

export function deleteLoan(c: Client, who: Wallet, loanId: string) {
  return submit(c, who, { TransactionType: "LoanDelete", Account: who.address, LoanID: loanId });
}

export async function getLoanSnapshot(c: Client, loanId: string): Promise<LoanSnapshot> {
  const [e, now] = await Promise.all([loanEntry(c, loanId), ledgerCloseTime(c)]);
  const status = loanStatus(e);
  const open = status === "active" || status === "impaired";
  const due = e.NextPaymentDueDate as number | undefined;
  return {
    loanId,
    borrower: e.Borrower,
    principal: String(e.PrincipalOutstanding ?? "0"),
    interestRate: e.InterestRate ?? 0,
    paymentsRemaining: e.PaymentRemaining ?? null,
    nextDueIso: due ? new Date(rippleTimeToUnixTime(due)).toISOString() : null,
    totalOwed: e.TotalValueOutstanding != null ? String(e.TotalValueOutstanding) : null,
    status,
    installmentDue: open ? installmentAmount(e) : null,
    payoffAmount: open ? payoffAmount(e) : null,
    canImpair: status === "active" && !!due && now > due,
    canDefault: open && !!due && now > due + (e.GracePeriod ?? 0),
  };
}