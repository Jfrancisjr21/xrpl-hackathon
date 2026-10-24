import { describe, expect, it } from "vitest";
import { samples } from "../../samples";
import { applicationFromContract, loanFromContract } from "./contractAdapters";
import { loanPermissions } from "./model";

describe("broker contract adapters", () => {
  it("converts shared application amounts and rates for the broker view", () => {
    const application = applicationFromContract(samples.applicationApproved);

    expect(application).toMatchObject({
      id: "1",
      amount: 500,
      rate: 7.4,
      score: 88,
      status: "active",
      sanctions: "clear",
      decisionHash: samples.applicationApproved.decisionHash,
      loanId: samples.applicationApproved.loanId,
      txHash: samples.applicationApproved.tx?.hash,
    });
  });

  it("keeps denied, rejected and failed outcomes distinct", () => {
    const denied = applicationFromContract(samples.applicationDenied);
    const rejected = applicationFromContract({ ...samples.applicationApproved, status: "rejected", brokerNote: "Outside policy" });
    const failed = applicationFromContract({ ...samples.applicationApproved, status: "failed", error: "Ledger unavailable" });

    expect(denied.status).toBe("denied");
    expect(rejected).toMatchObject({ status: "rejected", brokerNote: "Outside policy" });
    expect(failed).toMatchObject({ status: "failed", error: "Ledger unavailable" });
  });

  it("uses ledger permissions instead of guessing from the browser clock", () => {
    const loan = loanFromContract(samples.loan);
    const permissions = loanPermissions(loan, Date.parse("2027-01-01T00:00:00Z"));

    expect(permissions.canImpair).toBe(false);
    expect(permissions.canDefault).toBe(false);
  });
});
