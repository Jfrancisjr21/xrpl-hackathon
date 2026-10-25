import type { AgentPolicy, ApprovalLevel, DecisionOutcome, ScoreBreakdown } from "@hack/shared";

export const DEFAULT_POLICY: AgentPolicy = { minScore: 50 };

// Limits per approval level. minScore of the lowest unsecured level follows the broker's policy.
export const LEVELS: { level: Exclude<ApprovalLevel, "secured">; minScore: number; maxAmount: number; maxPayments: number }[] = [
  { level: "A", minScore: 75, maxAmount: 1_000_000, maxPayments: 12 },
  { level: "B", minScore: 60, maxAmount: 100_000, maxPayments: 6 },
  { level: "C", minScore: 50, maxAmount: 10_000, maxPayments: 3 },
];
export const SECURED = { maxAmount: 1_000, maxPayments: 3 }; // credit-builder loan, fully backed by collateral
export const MAX_SHARE_OF_AVAILABLE = 0.2; // one loan takes at most 20% of the vault's available funds

// Vault and broker numbers the caps depend on (decimal strings from the ledger). Omit to skip those caps.
export interface Capacity {
  assetsAvailable: string;
  debtTotal: string;
  coverAvailable: string;
  coverRateMinimum: number; // 1/10th bp: 10000 = cover must be 10% of debt
}

export interface PolicyInput {
  amount: string; // requested, whole-number string
  paymentTotal: number;
  creditConsent: boolean;
  banned: boolean; // on our ban list after a defaulted loan
  creditFileFound: boolean;
  score: ScoreBreakdown;
  capacity?: Capacity;
}

export interface PolicyResult {
  outcome: DecisionOutcome;
  approvalLevel: ApprovalLevel | null;
  maxAmount: string | null;
  maxPaymentTotal: number | null;
  collateralRequired: string | null;
  reasons: string[]; // one line per rule that decided, for the Decision and the explanation
}

// Largest new loan the vault and first-loss cover can support. Below minimum cover the ledger refuses new loans.
export function capacityLimit(c: Capacity): number {
  const liquidity = Number(c.assetsAvailable) * MAX_SHARE_OF_AVAILABLE;
  const coverHeadroom = c.coverRateMinimum > 0
    ? (Number(c.coverAvailable) * 100000) / c.coverRateMinimum - Number(c.debtTotal)
    : Infinity;
  return Math.max(0, Math.floor(Math.min(liquidity, coverHeadroom)));
}

export function levelFor(score: number, policy: AgentPolicy): (typeof LEVELS)[number] | null {
  const lowest = Math.max(policy.minScore, LEVELS[LEVELS.length - 1].minScore);
  if (score < lowest) return null;
  return LEVELS.find((l) => score >= l.minScore) ?? null;
}

// Runs after the sanctions gate. Revenue and fees are never an input here.
export function applyPolicy(input: PolicyInput, policy: AgentPolicy = DEFAULT_POLICY): PolicyResult {
  const denied = (reason: string, level: ApprovalLevel | null = null, maxAmount: string | null = null, maxPaymentTotal: number | null = null): PolicyResult =>
    ({ outcome: "denied", approvalLevel: level, maxAmount, maxPaymentTotal, collateralRequired: null, reasons: [reason] });

  if (input.banned) return denied("Address is on the ban list after a defaulted loan with us");
  if (!input.creditConsent) return denied("Credit check not authorized, so the application cannot be assessed");

  const amount = Number(input.amount);
  const capacity = input.capacity ? capacityLimit(input.capacity) : Infinity;
  const { total } = input.score;
  const tier = input.creditFileFound ? levelFor(total, policy) : null;

  // Thin or weak file: a secured credit-builder loan instead of a flat no.
  const level: ApprovalLevel = tier?.level ?? "secured";
  const levelMax = tier?.maxAmount ?? SECURED.maxAmount;
  const maxPayments = tier?.maxPayments ?? SECURED.maxPayments;
  const maxAmount = Math.min(levelMax, capacity);
  const why = !input.creditFileFound
    ? "No credit file found"
    : tier ? `Score ${total} qualifies for level ${tier.level}` : `Score ${total} is below the minimum of ${policy.minScore}`;
  const offer = tier ? "an unsecured loan" : "a secured credit-builder loan";

  if (maxAmount < 1) return denied(`${why}, but the vault cannot fund new loans right now (liquidity or first-loss cover)`, level);
  if (amount > maxAmount) {
    const limitedBy = maxAmount < levelMax ? " (limited by vault liquidity and first-loss cover)" : "";
    return denied(`${why}: ${offer} of up to ${maxAmount}${limitedBy} is available, less than the ${input.amount} requested`, level, String(maxAmount), maxPayments);
  }
  if (input.paymentTotal > maxPayments) {
    return denied(`${why}: ${offer} allows at most ${maxPayments} payments, not ${input.paymentTotal}`, level, String(maxAmount), maxPayments);
  }

  if (tier) {
    return { outcome: "approved", approvalLevel: level, maxAmount: String(maxAmount), maxPaymentTotal: maxPayments, collateralRequired: null,
      reasons: [`Score ${total} meets the minimum of ${policy.minScore} and qualifies for level ${tier.level}`] };
  }
  return { outcome: "secured_offer", approvalLevel: "secured", maxAmount: String(maxAmount), maxPaymentTotal: maxPayments, collateralRequired: input.amount,
    reasons: [`${why}. Offered a secured credit-builder loan backed by ${input.amount} of collateral`] };
}
