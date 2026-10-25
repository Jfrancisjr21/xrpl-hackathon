import {
  LoanManageFlags, LoanPayFlags, convertStringToHex, decode, rippleTimeToUnixTime, signLoanSetByCounterparty,
  type Client, type Wallet,
} from "xrpl";
import { serial, submit, checkResult, findCreated, ledgerCloseTime, ledgerEntry } from "./client";
import type { LoanSnapshot, LoanStatus, LoanTerms, PayMode } from "./types";

export const ORIGINATION_FEE_RATE = 0.01; // 1% of the principal, taken from it and paid to the broker
export const SERVICE_FEE = "10";          // added to every payment

// MPT amounts are whole numbers, so the fee rounds up: 500 -> 5, 1 -> 1.
export const originationFee = (principal: string) => String(Math.ceil(Number(principal) * ORIGINATION_FEE_RATE));

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
    LoanOriginationFee: originationFee(t.principal),
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

// Feature 1: the decision hash written into a LoanSet's memo, lowercase hex, or null if it has none.
export async function decisionMemo(c: Client, txHash: string): Promise<string | null> {
  const res: any = await c.request({ command: "tx", transaction: txHash } as any);
  const memos: any[] = res.result.tx_json?.Memos ?? res.result.Memos ?? [];
  const type = convertStringToHex("decision-sha256");
  const memo = memos.find((m) => m.Memo?.MemoType?.toUpperCase() === type);
  return memo ? String(memo.Memo.MemoData).toLowerCase() : null;
}

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
  const late = now > e.NextPaymentDueDate;
  // Payoff needs tfLoanFullPayment, or the ledger only takes one installment (confirmed on Devnet). But with one
  // payment left the ledger kills a full payment (tecKILLED, confirmed on Devnet): that last payment is a regular
  // one, late-flagged if overdue, for whichever is larger of the installment and what is still owed.
  const full = mode === "payoff" && Number(e.PaymentRemaining ?? 0) > 1;
  // XLS-66: while a payment is overdue only the late installment is accepted; a full payment fails with tecEXPIRED.
  if (full && late) throw new Error("A payment is overdue, so the loan cannot be paid off yet. Pay the amount due first");
  const value = full ? payoffAmount(e) : mode === "payoff"
    ? String(Math.max(Number(installmentAmount(e)), Number(payoffAmount(e))))
    : installmentAmount(e);
  const flags = full ? LoanPayFlags.tfLoanFullPayment : late ? LoanPayFlags.tfLoanLatePayment : 0;
  const tx = await submit(c, borrower, {
    TransactionType: "LoanPay", Account: borrower.address, LoanID: loanId,
    Amount: { mpt_issuance_id: mptId, value },
    ...(flags ? { Flags: flags } : {}),
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