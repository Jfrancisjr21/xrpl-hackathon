import { describe, expect, it } from "vitest";
import { estimateLoan, platformFeeOn } from "./fees";

const MONTH_SEC = (365 * 24 * 60 * 60) / 12;

describe("platformFeeOn", () => {
  it("takes 10 percent of interest at the maximum rate", () => {
    expect(platformFeeOn("273", 10000)).toBe("27.30");
  });

  it("is zero at a zero rate", () => {
    expect(platformFeeOn("273", 0)).toBe("0.00");
  });
});

describe("estimateLoan", () => {
  // The worked example in 00 Overview: 10,000 at 5 percent, 12 monthly payments.
  const est = estimateLoan({ principal: "10000", interestRate: 5000, paymentTotal: 12, paymentIntervalSec: MONTH_SEC });

  it("matches the Overview example: interest about 273, fee about 27", () => {
    expect(Math.round(Number(est.totalInterest))).toBe(273);
    expect(Math.round(Number(est.platformFee))).toBe(27);
    expect(Math.round(Number(est.depositorShare))).toBe(246);
  });

  it("adds up: payments cover principal plus interest, and fee plus depositor share is the interest", () => {
    expect(Number(est.totalRepaid)).toBeCloseTo(10000 + Number(est.totalInterest), 1);
    expect(Number(est.platformFee) + Number(est.depositorShare)).toBeCloseTo(Number(est.totalInterest), 2);
  });

  it("splits a zero-interest loan evenly", () => {
    const zero = estimateLoan({ principal: "1200", interestRate: 0, paymentTotal: 12, paymentIntervalSec: MONTH_SEC });
    expect(zero.periodicPayment).toBe("100.00");
    expect(zero.totalInterest).toBe("0.00");
  });

  it("returns decimal strings, never numbers", () => {
    for (const value of Object.values(est)) expect(value).toMatch(/^\d+\.\d{2}$/);
  });
});
