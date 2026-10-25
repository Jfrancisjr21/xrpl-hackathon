import type { Decision } from "@hack/shared";
import { describe, expect, it } from "vitest";
import { samples } from "../../samples";
import { reapplyTerms } from "./status";

const denied = (over: Partial<Decision>): Decision => ({
  ...samples.decisions.carol!, approved: false, outcome: "denied", interestRate: null, ...over,
});

describe("reapplyTerms", () => {
  it("offers the level's payment limit when that was the only problem (Carol over 12 payments)", () => {
    const d = denied({ approvalLevel: "C", maxAmount: "1900", maxPaymentTotal: 3 });
    expect(reapplyTerms({ amount: "500", paymentTotal: 12 }, d)).toEqual({ amount: "500", paymentTotal: 3 });
  });

  it("caps the amount when the amount was over the limit", () => {
    const d = denied({ approvalLevel: "C", maxAmount: "1900", maxPaymentTotal: 3 });
    expect(reapplyTerms({ amount: "5000", paymentTotal: 3 }, d)).toEqual({ amount: "1900", paymentTotal: 3 });
  });

  it("works for a secured offer's limits too (Bob over 3 payments)", () => {
    const d = denied({ approvalLevel: "secured", maxAmount: "1000", maxPaymentTotal: 3 });
    expect(reapplyTerms({ amount: "500", paymentTotal: 12 }, d)).toEqual({ amount: "500", paymentTotal: 3 });
  });

  it("offers nothing for a denial that is not about limits, or when the vault cannot lend", () => {
    expect(reapplyTerms({ amount: "500", paymentTotal: 3 }, denied({ approvalLevel: "C", maxAmount: "1900", maxPaymentTotal: 3 }))).toBeNull();
    expect(reapplyTerms({ amount: "500", paymentTotal: 12 }, denied({ approvalLevel: null, maxAmount: null, maxPaymentTotal: null }))).toBeNull();
    expect(reapplyTerms({ amount: "500", paymentTotal: 12 }, denied({ approvalLevel: "C", maxAmount: "0", maxPaymentTotal: 3 }))).toBeNull();
    expect(reapplyTerms({ amount: "500", paymentTotal: 12 }, samples.decisions.alice!)).toBeNull(); // approved
  });
});
