import type { Rate } from "@hack/shared";

// Yearly interest rate in tenths of a basis point: 25 percent minus 0.2 percent per score point,
// floored at 5 percent. Fits the plan's examples: 88 -> 7400 (7.4%), 61 -> 12800 (12.8%), 100 -> 5000.
export const MIN_RATE: Rate = 5000;

export function priceLoan(score: number): Rate {
  return Math.max(MIN_RATE, 25000 - 200 * score);
}

// Secured credit-builder loans are fully backed by collateral, so they get the lowest rate.
export const SECURED_RATE: Rate = MIN_RATE;
