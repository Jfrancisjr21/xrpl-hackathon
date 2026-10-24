import { describe, expect, it } from "vitest";
import { samples } from "./index";

// index.ts already parses every file against the contract (importing it throws on drift).
// These check that the samples tell one consistent story.
describe("samples", () => {
  it("agree with each other", () => {
    const { vault, loan, applicationApproved, wallets } = samples;
    const lent = Number(vault.assetsTotal) - Number(vault.assetsAvailable);
    expect(lent).toBe(Number(loan.principal));
    expect(vault.utilizationPct).toBe((lent / Number(vault.assetsTotal)) * 100);
    expect(samples.health.vaultPhase).toBe(vault.phase);
    expect(vault.position?.address).toBe(wallets.find((w) => w.role === "depositor")?.address);
    expect(loan.applicationId).toBe(applicationApproved.id);
    expect(loan.loanId).toBe(applicationApproved.loanId);
    expect(loan.borrower).toBe(applicationApproved.borrowerAddress);
    expect(Number(loan.installmentDue) * applicationApproved.paymentTotal).toBeCloseTo(Number(loan.totalOwed), 1);
  });

  it("filters by borrower the way the API does", () => {
    expect(samples.loansFor(samples.loan.borrower)).toEqual([samples.loan]);
    expect(samples.loansFor()).toHaveLength(1);
    expect(samples.applicationsFor(samples.applicationDenied.borrowerAddress)).toEqual([samples.applicationDenied]);
  });
});
