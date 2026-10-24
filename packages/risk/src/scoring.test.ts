import type { CreditSummary } from "@hack/shared";
import { describe, expect, it } from "vitest";
import { applyPolicy, capacityLimit, DEFAULT_POLICY, levelFor, SECURED } from "./policy";
import { priceLoan, SECURED_RATE } from "./pricing";
import { creditPart, middleScore, scoreAccount, scoreWallet } from "./score";

// Persona facts from the ledger's demo-profiles.ts.
const alice = { ageDays: 365, txCountSample: 120, trustlineCount: 4, hasCredential: true };
const carol = { ageDays: 180, txCountSample: 80, trustlineCount: 3, hasCredential: true };
const bob = { ageDays: 20, txCountSample: 12, trustlineCount: 1, hasCredential: false };

const report = (middle: number | null): CreditSummary => ({
  provider: "demo", pullType: "soft", pulledAt: new Date().toISOString(),
  fileFound: middle !== null, scores: [], middleScore: middle, reasonCodes: [],
});
// iSoftpull test applicants: A ~ 775 (real demo pull: 742 / 775 / 780), B ~ 600, E has no file.
const aliceCredit = report(775), carolCredit = report(600), bobCredit = report(null);

describe("wallet score", () => {
  it("gives the personas their planned wallet scores", () => {
    expect(scoreWallet(alice).wallet).toBe(88);
    expect(scoreWallet(carol).wallet).toBe(61);
    expect(scoreWallet(bob).wallet).toBe(7);
  });

  it("caps every signal at 100 in total", () => {
    expect(scoreWallet({ ageDays: 5000, txCountSample: 9000, trustlineCount: 50, hasCredential: true }).wallet).toBe(100);
  });
});

describe("credit part", () => {
  it("maps the middle FICO score onto 0-100", () => {
    expect(creditPart(report(300))).toBe(0);
    expect(creditPart(report(850))).toBe(100);
    expect(creditPart(aliceCredit)).toBe(86);
  });

  it("is null with no credit file", () => {
    expect(creditPart(bobCredit)).toBeNull();
    expect(creditPart(null)).toBeNull();
  });

  it("takes the middle of three bureau scores", () => {
    expect(middleScore([780, 742, 775])).toBe(775);
    expect(middleScore([700])).toBe(700);
    expect(middleScore([])).toBeNull();
  });
});

describe("final score: 60% credit + 40% internal", () => {
  it("blends credit and internal for the personas", () => {
    expect(scoreAccount(alice, aliceCredit).total).toBe(87); // 0.6*86 + 0.4*88
    expect(scoreAccount(carol, carolCredit).total).toBe(57); // 0.6*55 + 0.4*61
  });

  it("uses the internal score alone with no credit file (missing data is not counted)", () => {
    expect(scoreAccount(bob, bobCredit).total).toBe(7);
  });

  it("only rewards loans paid off with us, and never past 100", () => {
    const fresh = scoreAccount(carol, carolCredit);
    const repaid = scoreAccount(carol, carolCredit, { loansPaidOff: 2 });
    expect(repaid.paidOffBonus).toBe(20);
    expect(repaid.internal).toBe(81);
    expect(repaid.total).toBeGreaterThan(fresh.total);
    expect(scoreAccount(alice, aliceCredit, { loansPaidOff: 9 }).internal).toBe(100);
  });
});

describe("policy", () => {
  const base = { amount: "500", paymentTotal: 3, creditConsent: true, banned: false, creditFileFound: true };
  // Demo vault after a big bootstrap: 5M available, 100k cover at a 10% minimum, no debt yet.
  const bigVault = { assetsAvailable: "5000000", debtTotal: "0", coverAvailable: "100000", coverRateMinimum: 10000 };

  it("approves Alice at level A with A's limits", () => {
    const r = applyPolicy({ ...base, amount: "500000", paymentTotal: 12, score: scoreAccount(alice, aliceCredit), capacity: bigVault });
    expect(r).toMatchObject({ outcome: "approved", approvalLevel: "A", maxAmount: "1000000", maxPaymentTotal: 12 });
    expect(r.reasons).toEqual(["Score 87 meets the minimum of 50 and qualifies for level A"]);
  });

  it("puts Carol (57) in level C: up to 10,000 over at most 3 payments", () => {
    const ok = applyPolicy({ ...base, amount: "10000", score: scoreAccount(carol, carolCredit) });
    expect(ok).toMatchObject({ outcome: "approved", approvalLevel: "C", maxAmount: "10000", maxPaymentTotal: 3 });
    const tooBig = applyPolicy({ ...base, amount: "50000", score: scoreAccount(carol, carolCredit) });
    expect(tooBig.outcome).toBe("denied");
    expect(tooBig.reasons[0]).toMatch(/up to 10000 is available, less than the 50000 requested/);
    const tooLong = applyPolicy({ ...base, amount: "5000", paymentTotal: 6, score: scoreAccount(carol, carolCredit) });
    expect(tooLong.reasons[0]).toMatch(/at most 3 payments, not 6/);
  });

  it("uses the score bands 75 / 60 / 50", () => {
    expect(levelFor(75, DEFAULT_POLICY)?.level).toBe("A");
    expect(levelFor(74, DEFAULT_POLICY)?.level).toBe("B");
    expect(levelFor(60, DEFAULT_POLICY)?.level).toBe("B");
    expect(levelFor(50, DEFAULT_POLICY)?.level).toBe("C");
    expect(levelFor(49, DEFAULT_POLICY)).toBeNull();
  });

  it("never offers more than 20% of the vault's available funds", () => {
    const smallVault = { ...bigVault, assetsAvailable: "10000" };
    const r = applyPolicy({ ...base, amount: "5000", score: scoreAccount(alice, aliceCredit), capacity: smallVault });
    expect(r.outcome).toBe("denied");
    expect(r.maxAmount).toBe("2000");
    expect(r.reasons[0]).toMatch(/limited by vault liquidity and first-loss cover/);
  });

  it("never lets total debt outgrow the first-loss cover", () => {
    expect(capacityLimit({ ...bigVault, coverAvailable: "1000" })).toBe(10000); // 1000 cover supports 10000 of debt
    expect(capacityLimit({ ...bigVault, coverAvailable: "1000", debtTotal: "9500" })).toBe(500);
    const full = applyPolicy({ ...base, score: scoreAccount(alice, aliceCredit), capacity: { ...bigVault, coverAvailable: "1000", debtTotal: "10000" } });
    expect(full.reasons[0]).toMatch(/cannot fund new loans right now/);
  });

  it("denies anyone on the ban list, whatever their score", () => {
    const r = applyPolicy({ ...base, banned: true, score: scoreAccount(alice, aliceCredit) });
    expect(r.outcome).toBe("denied");
    expect(r.reasons[0]).toMatch(/ban list/);
  });

  it("denies without credit consent", () => {
    expect(applyPolicy({ ...base, creditConsent: false, score: scoreAccount(alice, aliceCredit) }).outcome).toBe("denied");
  });

  it("offers a thin file a secured credit-builder loan up to 1,000", () => {
    const r = applyPolicy({ ...base, amount: "1000", creditFileFound: false, score: scoreAccount(bob, bobCredit) });
    expect(r).toEqual({
      outcome: "secured_offer", approvalLevel: "secured", maxAmount: String(SECURED.maxAmount), maxPaymentTotal: 3, collateralRequired: "1000",
      reasons: ["No credit file found. Offered a secured credit-builder loan backed by 1000 of collateral"],
    });
  });

  it("denies a thin file asking for more than the secured limit, and says what is available", () => {
    const r = applyPolicy({ ...base, amount: "5000", creditFileFound: false, score: scoreAccount(bob, bobCredit) });
    expect(r.outcome).toBe("denied");
    expect(r.reasons[0]).toMatch(/secured credit-builder loan of up to 1000 is available/);
  });

  it("offers a secured loan when the score is below the minimum", () => {
    const weak = scoreAccount(bob, report(500)); // file found but weak
    expect(applyPolicy({ ...base, amount: "50", score: weak }).outcome).toBe("secured_offer");
  });

  it("follows a broker's new pass mark", () => {
    expect(applyPolicy({ ...base, amount: "50", score: scoreAccount(carol, carolCredit) }, { minScore: 70 }).outcome).toBe("secured_offer");
  });
});

describe("pricing", () => {
  it("prices the blended persona scores", () => {
    expect(priceLoan(87)).toBe(7600); // Alice, 7.6%
    expect(priceLoan(57)).toBe(13600); // Carol, 13.6%
  });

  it("never goes below 5%, and secured loans get the floor", () => {
    expect(priceLoan(100)).toBe(5000);
    expect(SECURED_RATE).toBe(5000);
  });
});
