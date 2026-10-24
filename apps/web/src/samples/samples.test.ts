import { ApplicationView, DemoWallet, HealthResponse, LoanView, VaultView } from "@hack/shared";
import { describe, expect, it } from "vitest";
import { samples } from "./index";

// The samples stand in for the API, so they must stay valid against the contract and agree with each other.
describe("samples", () => {
  it("parse against the contract", () => {
    expect(() => HealthResponse.parse(samples.health)).not.toThrow();
    expect(() => DemoWallet.array().parse(samples.wallets)).not.toThrow();
    expect(() => VaultView.parse(samples.vault)).not.toThrow();
    expect(() => ApplicationView.parse(samples.applicationApproved)).not.toThrow();
    expect(() => ApplicationView.parse(samples.applicationDenied)).not.toThrow();
    expect(() => LoanView.parse(samples.loan)).not.toThrow();
  });

  it("agree with each other", () => {
    const v = samples.vault;
    expect(Number(v.assetsTotal) - Number(v.assetsAvailable)).toBe(Number(samples.loan.principal));
    expect(samples.health.vaultPhase).toBe(v.phase);
    expect(samples.loan.applicationId).toBe(samples.applicationApproved.id);
    expect(samples.loansFor(samples.loan.borrower)).toHaveLength(1);
    expect(samples.applicationsFor(samples.applicationDenied.borrowerAddress)).toEqual([samples.applicationDenied]);
  });
});
