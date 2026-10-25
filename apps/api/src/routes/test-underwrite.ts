import type { Underwrite } from "../services/underwriting";

// Test stand-in for underwriting: denies banned borrowers, otherwise approves at 10% with the broker's pass mark.
export const testUnderwrite: Underwrite = async (_input, ctx) => ({
  approved: !ctx.banned,
  sanctions: { blocked: false },
  facts: null,
  featureSource: null,
  score: null,
  minScore: ctx.minScore,
  interestRate: ctx.banned ? null : 10000,
  reasons: [ctx.banned ? "Address is on the ban list after a defaulted loan with us" : "ok"],
  explanation: "test",
  explanationSource: "template",
});
