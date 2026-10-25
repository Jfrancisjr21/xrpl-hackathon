import type { ApprovalLevel, DecisionOutcome, Rate } from "@hack/shared";

export interface ExplainInput {
  outcome: DecisionOutcome;
  reasons: string[];
  interestRate: Rate | null;
  approvalLevel: ApprovalLevel | null;
  maxAmount: string | null;
  collateralRequired: string | null;
}

const pct = (rate: Rate) => `${(rate / 1000).toFixed(1)}%`;

// Plain-language explanation from the decision. Template only: it describes the decision and never changes it.
// An AI model may rephrase this later (EXPLAIN_MODE), but the outcome, numbers and reasons always come from code.
export function explain(d: ExplainInput): string {
  const why = d.reasons.join(". ");
  if (d.outcome === "approved") {
    return `Approved at level ${d.approvalLevel} for up to ${d.maxAmount} at ${pct(d.interestRate!)} a year. ${why}. A broker reviews every loan before it is created.`;
  }
  if (d.outcome === "secured_offer") {
    return `Not approved for an unsecured loan, but offered a secured credit-builder loan of up to ${d.maxAmount} at ${pct(d.interestRate!)}, backed by ${d.collateralRequired} of your own funds. Repaying it builds history with us. ${why}.`;
  }
  return `Declined. ${why}.`;
}
