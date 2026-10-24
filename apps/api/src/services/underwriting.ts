import type { Decision, LoanApplicationInput } from "@hack/shared";

// What the API knows from its own database: the ban list and the borrower's history with us.
export interface UnderwriteContext {
  banned: boolean; // defaulted on a loan with us
  loansPaidOff: number; // feeds the internal score
  minScore: number; // the broker's pass mark (POST /api/agent/policy)
}

// Turns an application into the agent's Decision. Routes depend on this signature, not on @hack/risk directly.
export type Underwrite = (input: LoanApplicationInput, ctx: UnderwriteContext) => Promise<Decision>;

const base = { sanctions: { blocked: false }, facts: null, featureSource: null, score: null, explanationSource: "template" as const };

// shortcut: placeholder until risk/pipeline (evaluate) merges; it only applies the ban list, everything else goes to review unscored.
// Replace with a function that calls @hack/risk evaluate() with ledger facts, credit pull and this context.
export const placeholderUnderwrite: Underwrite = async (_input, ctx) =>
  ctx.banned
    ? {
        ...base,
        minScore: ctx.minScore,
        approved: false,
        interestRate: null,
        reasons: ["Address is on the ban list after a defaulted loan with us"],
        explanation: "This application was declined because a previous loan with us was defaulted.",
      }
    : {
        ...base,
        minScore: ctx.minScore,
        approved: true,
        interestRate: 10000, // placeholder 10% so approve can be tested end to end
        reasons: ["Placeholder decision: the risk pipeline is not merged yet"],
        explanation: "This application was not scored. The underwriting agent is not connected yet.",
      };
