import type { Client, Wallet } from "xrpl";
import { submit, findCreated, ledgerEntry } from "./client";

export const PLATFORM_FEE_RATE = 10000;      // 10 percent of interest (the maximum)
export const COVER_RATE_MINIMUM = 10000;     // cover must be at least 10 percent of debt
export const COVER_RATE_LIQUIDATION = 10000; // share of minimum cover used on a default

// debtMaximum caps the broker's total outstanding debt on the ledger itself.
export async function createLoanBroker(c: Client, owner: Wallet, vaultId: string, debtMaximum: string) {
  const r = await submit(c, owner, {
    TransactionType: "LoanBrokerSet",
    Account: owner.address,
    VaultID: vaultId,
    ManagementFeeRate: PLATFORM_FEE_RATE,
    CoverRateMinimum: COVER_RATE_MINIMUM,
    CoverRateLiquidation: COVER_RATE_LIQUIDATION,
    DebtMaximum: debtMaximum,
  });
  return findCreated(r.meta, "LoanBroker").LedgerIndex; // the LoanBrokerID
}

export function coverDeposit(c: Client, owner: Wallet, loanBrokerId: string, mptId: string, amount: string) {
  return submit(c, owner, {
    TransactionType: "LoanBrokerCoverDeposit", Account: owner.address,
    LoanBrokerID: loanBrokerId, Amount: { mpt_issuance_id: mptId, value: amount },
  });
}

export function coverWithdraw(c: Client, owner: Wallet, loanBrokerId: string, mptId: string, amount: string) {
  return submit(c, owner, {
    TransactionType: "LoanBrokerCoverWithdraw", Account: owner.address,
    LoanBrokerID: loanBrokerId, Amount: { mpt_issuance_id: mptId, value: amount },
  });
}

// Fields: DebtTotal, DebtMaximum, CoverAvailable, CoverRateMinimum, CoverRateLiquidation, ManagementFeeRate.
export const brokerEntry = (c: Client, loanBrokerId: string) => ledgerEntry(c, loanBrokerId);