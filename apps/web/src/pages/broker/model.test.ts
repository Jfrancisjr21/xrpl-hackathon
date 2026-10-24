import { describe, expect, it } from "vitest";
import {
  agentPolicyError,
  applicationDecisionError,
  auditToCsv,
  coverAdjustmentError,
  coverAdjustmentWarning,
  coverAfterAdjustment,
  coverHealth,
  coverRatio,
  filterApplications,
  formatDate,
  formatMultiple,
  formatMoney,
  formatNumber,
  formatOverdueDuration,
  formatSeconds,
  loanActionError,
  loanPermissions,
  nextPolicyVersion,
  requiredCover,
  vaultUtilization,
} from "./model";
import type { ApplicationView, LoanView } from "./model";

describe("broker model", () => {
  it("calculates the minimum cover and health", () => {
    const snapshot = { debtTotal: 30_000, coverRateMinimum: 10_000, coverAvailable: 4_500 };
    expect(requiredCover(snapshot)).toBe(3_000);
    expect(coverRatio(snapshot)).toBe(1.5);
    expect(coverHealth(coverRatio(snapshot))).toBe("good");
  });

  it("keeps zero vault utilization finite", () => {
    expect(vaultUtilization({ vaultTotal: 48_000, debtTotal: 29_600 })).toBeCloseTo(61.6667, 3);
    expect(vaultUtilization({ vaultTotal: 0, debtTotal: 0 })).toBe(0);
  });

  it("validates cover adjustments and warns before dropping below minimum", () => {
    const snapshot = { coverAvailable: 5_200, debtTotal: 29_600, coverRateMinimum: 10_000 };

    expect(coverAfterAdjustment(snapshot, "deposit", 800)).toBe(6_000);
    expect(coverAfterAdjustment(snapshot, "withdraw", 800)).toBe(4_400);
    expect(coverAdjustmentError(snapshot, "deposit", 0)).toBe("Enter an amount greater than zero.");
    expect(coverAdjustmentError(snapshot, "withdraw", 5_201)).toBe(
      "The withdrawal cannot exceed available first-loss cover.",
    );
    expect(coverAdjustmentWarning(snapshot, "withdraw", 2_300)).toBe(
      "This withdrawal would put first-loss cover below the required minimum and pause platform fees.",
    );
    expect(coverAdjustmentWarning(snapshot, "withdraw", 2_000)).toBeNull();
  });

  it("enables ledger actions only when timing and status allow", () => {
    const loan: LoanView = {
      id: "LN-1",
      applicationId: "APP-1",
      borrower: "rBorrower",
      persona: "Alice",
      principal: 100,
      rate: 5,
      paymentsRemaining: 2,
      nextDue: "2026-10-24T14:00:00.000Z",
      totalOwed: 80,
      gracePeriodSeconds: 60,
      status: "active",
    };

    expect(loanPermissions(loan, Date.parse("2026-10-24T14:00:30.000Z"))).toMatchObject({
      canImpair: true,
      canDefault: false,
    });
    expect(loanPermissions(loan, Date.parse("2026-10-24T14:01:01.000Z"))).toMatchObject({
      canImpair: true,
      canDefault: true,
    });

    expect(loanActionError(loan, "default", Date.parse("2026-10-24T14:00:30.000Z"))).toBe(
      "Default is available after the due date and grace period.",
    );
    expect(loanActionError(loan, "default", Date.parse("2026-10-24T14:01:01.000Z"))).toBeNull();
    expect(loanActionError({ ...loan, status: "impaired" }, "unimpair")).toBeNull();
    expect(loanActionError({ ...loan, status: "paid" }, "delete")).toBeNull();
    expect(loanActionError({ ...loan, status: "defaulted" }, "impair")).toBe(
      "Only an active loan can be impaired.",
    );
  });

  it("describes overdue time without hiding short Devnet grace periods", () => {
    expect(formatOverdueDuration(0)).toBe("Not overdue");
    expect(formatOverdueDuration(30)).toBe("Less than 1 minute late");
    expect(formatOverdueDuration(180)).toBe("3 minutes late");
    expect(formatOverdueDuration(7_200)).toBe("2 hours late");
    expect(formatOverdueDuration(172_800)).toBe("2 days late");
  });

  it("renders invalid dates as missing data", () => {
    expect(formatDate("not-a-date")).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate(null)).toBe("—");
  });

  it("formats operational numbers consistently", () => {
    expect(formatMoney(25_000)).toBe("25,000 XRP");
    expect(formatNumber(12_345)).toBe("12,345");
    expect(formatMultiple(1.756)).toBe("1.76×");
    expect(formatSeconds(60)).toBe("60 seconds");
    expect(formatSeconds(1)).toBe("1 second");
  });

  it("filters the application queue without changing all applications", () => {
    const pending = { id: "APP-1", status: "pending_review" } as ApplicationView;
    const rejected = { id: "APP-2", status: "rejected" } as ApplicationView;
    const applications = [pending, rejected];

    expect(filterApplications(applications, "pending_review")).toEqual([pending]);
    expect(filterApplications(applications, "all")).toEqual(applications);
  });

  it("guards application decisions in the UI", () => {
    const pending = { status: "pending_review", sanctions: "clear" } as ApplicationView;

    expect(applicationDecisionError(pending, "approve")).toBeNull();
    expect(applicationDecisionError(pending, "reject", "  ")).toBe(
      "Add a review note before rejecting this application.",
    );
    expect(applicationDecisionError({ ...pending, sanctions: "flagged" }, "approve")).toBe(
      "This application cannot be approved because the sanctions gate did not clear.",
    );
    expect(applicationDecisionError({ ...pending, status: "active" }, "approve")).toBe(
      "This application has already been decided.",
    );
  });

  it("validates agent policy boundaries and versions", () => {
    expect(agentPolicyError(50, 25)).toBeNull();
    expect(agentPolicyError(50.5, 25)).toBe("Minimum score must be a whole number from 0 to 100.");
    expect(agentPolicyError(50, 0)).toBe(
      "Maximum liquidity per loan must be greater than 0% and no more than 100%.",
    );
    expect(nextPolicyVersion("v2.0")).toBe("v2.1");
    expect(nextPolicyVersion("custom")).toBe("custom");
  });

  it("exports visible audit rows as escaped CSV", () => {
    const csv = auditToCsv([{
      id: "AUD-1",
      at: "2026-10-24T14:00:00.000Z",
      actor: "broker",
      action: "Policy updated",
      subject: "Agent policy",
      reason: "Score 50, max 25% of available funds",
      txHash: "ABC123",
    }]);

    expect(csv).toContain('"Time","Actor","Title","Detail","Object","Transaction"');
    expect(csv).toContain('"Score 50, max 25% of available funds"');
    expect(csv).toContain("https://devnet.xrpl.org/transactions/ABC123");
  });
});
