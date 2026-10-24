import type { Decision, LoanApplicationInput } from "@hack/shared";

// Turns an application into the agent's Decision. Routes depend on this signature, not on @hack/risk directly.
export type Underwrite = (input: LoanApplicationInput) => Promise<Decision>;

// shortcut: placeholder until risk/pipeline (evaluate) merges; every application goes to review unscored.
// Replace with a function that calls @hack/risk evaluate() with ledger facts, credit pull and history.
export const placeholderUnderwrite: Underwrite = async () => ({
  approved: true,
  sanctions: { blocked: false },
  facts: null,
  featureSource: null,
  score: null,
  minScore: 50,
  interestRate: null,
  reasons: ["Placeholder decision: the risk pipeline is not merged yet"],
  explanation: "This application was not scored. The underwriting agent is not connected yet.",
  explanationSource: "template",
});
