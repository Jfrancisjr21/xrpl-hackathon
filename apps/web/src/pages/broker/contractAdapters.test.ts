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
      status: "approved",
      sanctions: "clear",
    });
  });

  it("uses ledger permissions instead of guessing from the browser clock", () => {
    const loan = loanFromContract(samples.loan);
    const permissions = loanPermissions(loan, Date.parse("2027-01-01T00:00:00Z"));

    expect(permissions.canImpair).toBe(false);
    expect(permissions.canDefault).toBe(false);
  });
});
