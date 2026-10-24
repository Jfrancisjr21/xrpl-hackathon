import { afterEach, describe, expect, it, vi } from "vitest";
import { samples } from "./index";

// index.ts already parses every file against the contract (importing it throws on drift).
// These check that the samples tell one consistent story, and that the mock vault keeps the ledger's rules.

const depositor = samples.wallets.find((w) => w.role === "depositor")!.address;
const alice = samples.wallets.find((w) => w.role === "alice")!.address;
const at = (iso: string, plusMs: number) => vi.setSystemTime(Date.parse(iso) + plusMs);

afterEach(() => { vi.useRealTimers(); });

describe("samples", () => {
  it("agree with each other", () => {
    const { loan, applicationApproved, vault, wallets } = samples;
    expect(vault.position?.address).toBe(wallets.find((w) => w.role === "depositor")?.address);
    expect(loan.applicationId).toBe(applicationApproved.id);
    expect(loan.loanId).toBe(applicationApproved.loanId);
    expect(loan.borrower).toBe(applicationApproved.borrowerAddress);
    expect(Number(loan.installmentDue) * applicationApproved.paymentTotal).toBeCloseTo(Number(loan.totalOwed), 1);
  });
});

describe("mock applications", () => {
  const addressOf = (role: string) => samples.wallets.find((w) => w.role === role)!.address;
  const apply = (role: string, amount = "500") => samples.apply({ borrowerAddress: addressOf(role), amount, paymentTotal: 6 });

  it("answers 409 with opensAt during the deposit window", async () => {
    await expect(apply("alice")).rejects.toMatchObject({ status: 409, opensAt: samples.timeline.subscriptionDate });
  });

  it("scores each persona once loans open, refuses a second open application, and the broker approves", async () => {
    vi.useFakeTimers();
    at(samples.timeline.subscriptionDate, 1000);
    const alice = await apply("alice");
    expect(alice).toMatchObject({ status: "pending_review", amount: "500", paymentTotal: 6 });
    expect(alice.decision.interestRate).toBe(7400);
    expect(alice.decisionHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(apply("alice")).rejects.toMatchObject({ status: 409, opensAt: null });
    expect((await apply("carol")).decision.interestRate).toBe(12800);
    expect(await apply("bob")).toMatchObject({ status: "denied", decision: { approved: false, score: { total: 7 } } });
    expect(await apply("borrower")).toMatchObject({ status: "denied", decision: { sanctions: { blocked: true, source: "demo" }, score: null } });
    await expect(apply("depositor")).rejects.toMatchObject({ status: 400 });
    await expect(apply("carol", "12.5")).rejects.toMatchObject({ status: 400 });

    await vi.advanceTimersByTimeAsync(20_000);
    expect((await samples.application(alice.id)).status).toBe("originating");
    await vi.advanceTimersByTimeAsync(3_000);
    const done = await samples.application(alice.id);
    expect(done.status).toBe("active");
    expect(done.loanId).toMatch(/^[0-9A-F]{64}$/);
    expect(done.tx?.explorerUrl).toContain(done.tx?.hash);
    expect(samples.applicationsFor(addressOf("alice")).map((a) => a.id)).toEqual([alice.id]);
    await expect(samples.application(999)).rejects.toMatchObject({ status: 404 });
  });
});

describe("mock vault", () => {
  it("opens as a fresh vault: deposit window running, nothing lent, no loans", () => {
    const v = samples.vaultFor(depositor);
    expect(v.phase).toBe("subscription");
    expect(samples.health().vaultPhase).toBe("subscription");
    expect(v.assetsAvailable).toBe(v.assetsTotal);
    expect(v.utilizationPct).toBe(0);
    expect(v.position).toEqual({ address: depositor, deposited: "2500", sharePct: 25 });
    expect(samples.loansFor()).toEqual([]);
  });

  it("takes a deposit during the window and raises the total and the position (R1)", async () => {
    const tx = await samples.deposit(depositor, "100");
    expect(tx.result).toBe("tesSUCCESS");
    expect(tx.explorerUrl).toContain(tx.hash);
    const v = samples.vaultFor(depositor);
    expect(v.assetsTotal).toBe("10100");
    expect(v.position?.deposited).toBe("2600");
  });

  it("refuses a decimal amount, as the contract does", async () => {
    await expect(samples.deposit(depositor, "12.5")).rejects.toThrow();
  });

  it("refuses withdrawals before redemption", async () => {
    await expect(samples.withdraw(depositor, "100")).rejects.toThrow("Withdrawals open at the redemption date.");
  });

  it("closes deposits after the window and draws Alice's loan", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(samples.timeline.subscriptionDate, 1000);
    await expect(samples.deposit(depositor, "100")).rejects.toThrow("Deposits are closed");
    const v = samples.vaultFor();
    expect(v.phase).toBe("investment");
    expect(Number(v.assetsTotal) - Number(v.assetsAvailable)).toBe(Number(samples.loan.principal));
    expect(samples.loansFor(alice)).toEqual([samples.loan]);
  });

  it("allows withdrawals in redemption, up to the position", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(samples.timeline.redemptionDate, 1000);
    await expect(samples.withdraw(depositor, "999999")).rejects.toThrow("at most 2600");
    await samples.withdraw(depositor, "600");
    expect(samples.vaultFor(depositor).position?.deposited).toBe("2000");
  });
});
