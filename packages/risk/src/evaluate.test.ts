import { Decision, type CreditSummary } from "@hack/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { evaluate, type EvaluateContext } from "./evaluate";

const ALICE = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb";
const CAROL = "rnfZk26oqAJ9vAp2eN6p8JysktcVp3VmoW";
const BOB = "rGgZFNrAko9bofdegqwMq2TxLVyXJnUn95";
const MALLORY = "rPXGUmAeAV7YMtxu8pv8PuHPrTzw49YVtP";
const OFAC = "rnXyVQzgxZe7TR1EPzTkGj2jxH4LMJYh66";

// Persona facts from the ledger's demo-profiles.ts; credit like iSoftpull's test applicants A, B and E.
const facts = {
  [ALICE]: { ageDays: 365, txCountSample: 120, trustlineCount: 4, hasCredential: true },
  [CAROL]: { ageDays: 180, txCountSample: 80, trustlineCount: 3, hasCredential: true },
  [BOB]: { ageDays: 20, txCountSample: 12, trustlineCount: 1, hasCredential: false },
};
const credit = (middle: number | null, reasons: string[] = []): CreditSummary => ({
  provider: "demo", pullType: "soft", pulledAt: "2026-10-24T22:00:00.000Z", fileFound: middle !== null,
  scores: middle ? [{ bureau: "transunion", model: "FICO 8", score: middle }] : [], middleScore: middle, reasonCodes: reasons,
});
const reports = { [ALICE]: credit(775, ["Amount owed on accounts too high"]), [CAROL]: credit(600), [BOB]: credit(null) };

let pulls: string[];
const ctx = (over: Partial<EvaluateContext> = {}): EvaluateContext => ({
  banned: false,
  history: { loansPaidOff: 0 },
  sanctionsExtra: { [MALLORY]: "Sanctions demo (borrower role)" },
  getFacts: async (a) => ({ facts: facts[a as keyof typeof facts], featureSource: "demo-profile" }),
  pullCredit: async (a) => { pulls.push(a); return reports[a as keyof typeof reports]; },
  ...over,
});
const apply = (borrowerAddress: string, amount = "500", paymentTotal = 3, creditConsent = true) => ({ borrowerAddress, amount, paymentTotal, creditConsent });

beforeEach(() => { pulls = []; });

describe("evaluate: the demo personas", () => {
  it("approves Alice at level A, 7.6%, with a clear reason", async () => {
    const d = Decision.parse(await evaluate(apply(ALICE), ctx()));
    expect(d).toMatchObject({ approved: true, outcome: "approved", approvalLevel: "A", interestRate: 7600, maxPaymentTotal: 12 });
    expect(d.score?.total).toBe(87);
    expect(d.reasons[0]).toBe("Score 87 meets the minimum of 50 and qualifies for level A");
    expect(d.reasons).toContain("Credit report: Amount owed on accounts too high");
    expect(d.explanation).toMatch(/^Approved at level A for up to 1000000 at 7\.6% a year/);
  });

  it("approves Carol at level C, 13.6%", async () => {
    const d = await evaluate(apply(CAROL), ctx());
    expect(d).toMatchObject({ outcome: "approved", approvalLevel: "C", interestRate: 13600, maxAmount: "10000" });
  });

  it("offers Bob (no credit file) a secured credit-builder loan at 5%", async () => {
    const d = Decision.parse(await evaluate(apply(BOB), ctx()));
    expect(d).toMatchObject({ approved: false, outcome: "secured_offer", approvalLevel: "secured", interestRate: 5000, collateralRequired: "500" });
    expect(d.explanation).toMatch(/secured credit-builder loan of up to 1000/);
  });

  it("blocks Mallory on sanctions before anything else, with no credit pull (R17)", async () => {
    const d = Decision.parse(await evaluate(apply(MALLORY), ctx()));
    expect(d).toMatchObject({ approved: false, outcome: "denied", sanctions: { blocked: true, source: "demo" }, score: null, credit: null });
    expect(d.reasons[0]).toMatch(/demo sanctions list/);
    expect(pulls).toEqual([]);
  });

  it("blocks the real OFAC address the same way", async () => {
    const d = await evaluate(apply(OFAC), ctx());
    expect(d.reasons[0]).toBe("Address matches the OFAC sanctions list (CHATEX)");
  });
});

describe("evaluate: gates before the credit pull", () => {
  it("denies a banned borrower without pulling credit", async () => {
    const d = await evaluate(apply(ALICE), ctx({ banned: true }));
    expect(d).toMatchObject({ outcome: "denied", banned: true });
    expect(pulls).toEqual([]);
  });

  it("denies without credit consent, and does not pull", async () => {
    const d = await evaluate(apply(ALICE, "500", 3, false), ctx());
    expect(d.reasons).toEqual(["Credit check not authorized, so the application cannot be assessed"]);
    expect(pulls).toEqual([]);
  });

  it("pulls credit exactly once when the gates pass", async () => {
    await evaluate(apply(ALICE), ctx());
    expect(pulls).toEqual([ALICE]);
  });
});

describe("evaluate: limits, history and the broker's policy", () => {
  it("respects the vault's liquidity cap and says so", async () => {
    const capacity = { assetsAvailable: "10000", debtTotal: "0", coverAvailable: "1000", coverRateMinimum: 10000 };
    const d = await evaluate(apply(ALICE, "5000"), ctx({ capacity }));
    expect(d).toMatchObject({ outcome: "denied", maxAmount: "2000" });
    expect(d.reasons[0]).toMatch(/limited by vault liquidity/);
  });

  it("rewards loans paid off with us", async () => {
    const fresh = await evaluate(apply(CAROL), ctx());
    const repaid = await evaluate(apply(CAROL), ctx({ history: { loansPaidOff: 2 } }));
    expect(repaid.score!.total).toBeGreaterThan(fresh.score!.total);
  });

  it("uses the broker's pass mark", async () => {
    const d = await evaluate(apply(CAROL, "500"), ctx({ policy: { minScore: 70 } }));
    expect(d).toMatchObject({ outcome: "secured_offer", minScore: 70 });
  });
});
