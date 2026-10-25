import type { AccountFacts, AgentPolicy, CreditSummary, Decision, FeatureSource, LoanApplicationInput } from "@hack/shared";
import { explain } from "./explain";
import { applyPolicy, DEFAULT_POLICY, type Capacity } from "./policy";
import { priceLoan, SECURED_RATE } from "./pricing";
import { checkAddress, type SanctionsIndex } from "./sanctions";
import { scoreAccount, type InternalHistory } from "./score";

// Everything evaluate() needs. The fetchers are only called once the cheap gates have passed,
// so a sanctioned, banned or non-consenting borrower never gets a credit pull.
export interface EvaluateContext {
  sanctionsExtra?: SanctionsIndex; // demo entries, e.g. the borrower role's address (R17)
  banned: boolean;
  history: InternalHistory;
  policy?: AgentPolicy;
  capacity?: Capacity; // vault liquidity and first-loss cover caps
  getFacts: (address: string) => Promise<{ facts: AccountFacts; featureSource: FeatureSource }>;
  pullCredit: (address: string) => Promise<CreditSummary>; // soft pull; a thin file comes back with fileFound: false
}

// The underwriting agent. Order matters: sanctions -> ban list -> consent -> facts + credit -> score -> policy -> price -> explain.
// Every step that decides is plain code; nothing here calls an AI model.
export async function evaluate(input: LoanApplicationInput, ctx: EvaluateContext): Promise<Decision> {
  const policy = ctx.policy ?? DEFAULT_POLICY;
  const sanctions = checkAddress(input.borrowerAddress, ctx.sanctionsExtra);
  const stop = (reason: string, extra: Partial<Decision> = {}): Decision => {
    const reasons = [reason];
    return {
      approved: false, outcome: "denied", sanctions, banned: ctx.banned, facts: null, featureSource: null, credit: null, score: null,
      minScore: policy.minScore, interestRate: null, approvalLevel: null, maxAmount: null, maxPaymentTotal: null, collateralRequired: null,
      reasons, explanation: explain({ outcome: "denied", reasons, interestRate: null, approvalLevel: null, maxAmount: null, collateralRequired: null }),
      explanationSource: "template", ...extra,
    };
  };

  if (sanctions.blocked) return stop(`Address matches the ${sanctions.source === "ofac" ? "OFAC sanctions list" : "demo sanctions list"} (${sanctions.matchedEntry})`);
  if (ctx.banned) return stop("Address is on the ban list after a defaulted loan with us");
  if (!input.creditConsent) return stop("Credit check not authorized, so the application cannot be assessed");

  const [{ facts, featureSource }, credit] = await Promise.all([ctx.getFacts(input.borrowerAddress), ctx.pullCredit(input.borrowerAddress)]);
  const score = scoreAccount(facts, credit, ctx.history);
  const p = applyPolicy(
    { amount: input.amount, paymentTotal: input.paymentTotal, creditConsent: true, banned: false, creditFileFound: credit.fileFound, score, capacity: ctx.capacity },
    policy,
  );
  const interestRate = p.outcome === "approved" ? priceLoan(score.total) : p.outcome === "secured_offer" ? SECURED_RATE : null;

  return {
    approved: p.outcome === "approved",
    outcome: p.outcome,
    sanctions,
    banned: false,
    facts,
    featureSource,
    credit,
    score,
    minScore: policy.minScore,
    interestRate,
    approvalLevel: p.approvalLevel,
    maxAmount: p.maxAmount,
    maxPaymentTotal: p.maxPaymentTotal,
    collateralRequired: p.collateralRequired,
    reasons: [...p.reasons, ...credit.reasonCodes.slice(0, 2).map((r) => `Credit report: ${r}`)],
    explanation: explain({ ...p, interestRate, reasons: p.reasons }),
    explanationSource: "template",
  };
}
