import { describe, expect, it } from "vitest";
import { Address, AmountInput, ApplicationIdParam, AuditEvent, Decision, LoanApplicationInput, Role } from "./index";

const alice = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb"; // a real Devnet faucet address

describe("contract", () => {
  it("accepts a real Devnet address and rejects junk", () => {
    expect(Address.safeParse(alice).success).toBe(true);
    expect(Address.safeParse("x").success).toBe(false);
  });

  it("only accepts whole-number amounts from users (MPT amounts are integers)", () => {
    expect(AmountInput.safeParse("500").success).toBe(true);
    for (const bad of ["10.5", "0", "007", 500]) expect(AmountInput.safeParse(bad).success).toBe(false);
  });

  it("treats Mallory as the borrower role, not a role of her own", () => {
    expect(Role.safeParse("borrower").success).toBe(true);
    expect(Role.safeParse("mallory").success).toBe(false);
  });

  it("reports every bad field of an application at once", () => {
    const r = LoanApplicationInput.safeParse({ borrowerAddress: "x", amount: "abc", paymentTotal: 99 });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path[0]).sort()).toEqual(["amount", "borrowerAddress", "paymentTotal"]);
  });

  it("allows a sanctions block with no score (Mallory never reaches scoring)", () => {
    const mallory = {
      approved: false, sanctions: { blocked: true, source: "demo" }, facts: null, featureSource: null, score: null,
      minScore: 50, interestRate: null, reasons: ["sanctions match"], explanation: "Blocked.", explanationSource: "template",
    };
    expect(Decision.safeParse(mallory).success).toBe(true);
  });

  it("requires ISO dates in the audit log (R15)", () => {
    const event = { id: 1, actor: "system", action: "demo_reset" };
    expect(AuditEvent.safeParse({ ...event, at: new Date().toISOString() }).success).toBe(true);
    expect(AuditEvent.safeParse({ ...event, at: "2026-10-24 15:30:00" }).success).toBe(false);
  });

  it("turns an application id from the URL into a number", () => {
    expect(ApplicationIdParam.parse({ id: "7" }).id).toBe(7);
  });
});
