import type { AccountFacts, CreditSummary, ScoreBreakdown } from "@hack/shared";

export const CREDIT_WEIGHT = 0.6; // bureau credit
export const INTERNAL_WEIGHT = 0.4; // what we know: wallet signals + loans paid off with us
export const PAID_OFF_POINTS = 10; // per loan fully repaid on our platform

export interface InternalHistory {
  loansPaidOff: number;
}

// Four on-chain signals, 0-100. Formula from the ledger's demo-profiles.ts: alice 88, carol 61, bob 7.
export function scoreWallet(f: AccountFacts) {
  const age = Math.min(Math.floor((f.ageDays / 365) * 30), 30); // full marks at 1 year
  const activity = Math.min(Math.floor((f.txCountSample / 200) * 30), 30); // full marks at 200 transactions
  const trustlines = Math.min(f.trustlineCount * 5, 20); // 5 each, up to 4
  const credential = f.hasCredential ? 20 : 0; // KYC credential from the issuer
  return { age, activity, trustlines, credential, wallet: age + activity + trustlines + credential };
}

// FICO 300-850 mapped to 0-100. Null with no credit file.
export function creditPart(credit: CreditSummary | null): number | null {
  if (!credit?.fileFound || credit.middleScore === null) return null;
  return Math.round(((credit.middleScore - 300) / 550) * 100);
}

// Missing data is not counted: no credit file means the internal score stands alone, and no paid-off loans add nothing.
export function scoreAccount(f: AccountFacts, credit: CreditSummary | null = null, history: InternalHistory = { loansPaidOff: 0 }): ScoreBreakdown {
  const w = scoreWallet(f);
  const paidOffBonus = Math.min(history.loansPaidOff * PAID_OFF_POINTS, 100);
  const internal = Math.min(w.wallet + paidOffBonus, 100);
  const credit0to100 = creditPart(credit);
  const total = credit0to100 === null ? internal : Math.round(CREDIT_WEIGHT * credit0to100 + INTERNAL_WEIGHT * internal);
  return { ...w, paidOffBonus, internal, credit: credit0to100, total };
}

// The middle of the bureaus' scores (lower middle for two). Null when no bureau returned one.
export function middleScore(scores: number[]): number | null {
  if (!scores.length) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}
