import { afterEach, describe, expect, it, vi } from "vitest";
import { samples } from "./index";

// The mock application and loan routes, in their own file so the vault tests start from a fresh module.

const addressOf = (role: string) => samples.wallets.find((w) => w.role === role)!.address;
const apply = (role: string, amount = "500") => samples.apply({ borrowerAddress: addressOf(role), amount, paymentTotal: 6 });
const lentOut = () => { const v = samples.vaultFor(); return Number(v.assetsTotal) - Number(v.assetsAvailable); };

afterEach(() => { vi.useRealTimers(); });

describe("mock applications", () => {
  it("answers 409 with opensAt during the deposit window", async () => {
    await expect(apply("alice")).rejects.toMatchObject({ status: 409, opensAt: samples.timeline.subscriptionDate });
  });

  it("scores each persona, refuses a second open application, then the broker approves and the loan is paid off", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(samples.timeline.subscriptionDate) + 1000);
    const alice = await apply("alice");
    expect(alice).toMatchObject({ status: "pending_review", amount: "500", paymentTotal: 6 });
    expect(alice.decision.interestRate).toBe(7400);
    expect(alice.decisionHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(apply("alice")).rejects.toMatchObject({ status: 409, opensAt: null });
    expect((await apply("carol", "300")).decision.interestRate).toBe(12800);
    expect(await apply("bob")).toMatchObject({ status: "denied", decision: { approved: false, score: { total: 7 } } });
    expect(await apply("borrower")).toMatchObject({ status: "denied", decision: { sanctions: { blocked: true, source: "demo" }, score: null } });
    await expect(apply("depositor")).rejects.toMatchObject({ status: 400 });
    await expect(apply("carol", "12.5")).rejects.toMatchObject({ status: 400 });
    expect(lentOut()).toBe(0);

    // The broker approves after 20 s, the LoanSet takes 3 s: both loans exist and are lent out of the vault.
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await samples.application(alice.id)).status).toBe("originating");
    await vi.advanceTimersByTimeAsync(3_000);
    const done = await samples.application(alice.id);
    expect(done.status).toBe("active");
    expect(done.tx?.explorerUrl).toContain(done.tx?.hash);
    const [loan] = samples.loansFor(addressOf("alice"));
    expect(loan).toMatchObject({ loanId: done.loanId, applicationId: alice.id, status: "active", principal: "500", paymentsRemaining: 6, canImpair: false });
    expect(lentOut()).toBe(800);

    // One installment: one fewer payment, the due date moves one interval, the principal falls.
    const firstDue = Date.parse(loan.nextDueIso!);
    const paid = await samples.payDue(loan.loanId);
    expect(paid.amount).toBe(loan.installmentDue);
    expect(paid.tx.result).toBe("tesSUCCESS");
    const after = samples.loansFor(addressOf("alice"))[0];
    expect(after.paymentsRemaining).toBe(5);
    expect(Date.parse(after.nextDueIso!) - firstDue).toBe(60_000);
    expect(Number(after.principal)).toBeLessThan(500);
    expect(Number(after.totalOwed)).toBeGreaterThanOrEqual(Number(after.principal));

    // Carol never pays: late once her due date passes, impaired by the broker 20 s later.
    vi.setSystemTime(Date.now() + 61_000);
    expect(samples.loansFor(addressOf("carol"))[0]).toMatchObject({ status: "active", canImpair: true });
    vi.setSystemTime(Date.now() + 20_000);
    expect(samples.loansFor(addressOf("carol"))[0]).toMatchObject({ status: "impaired", canDefault: false });
    vi.setSystemTime(Date.now() + 40_000); // past the 60 s grace period
    expect(samples.loansFor(addressOf("carol"))[0]).toMatchObject({ status: "impaired", canDefault: true });

    // Alice pays off: the loan closes, its amounts are null, and she may apply again.
    await samples.pay(loan.loanId, "payoff");
    expect(samples.loansFor(addressOf("alice"))[0]).toMatchObject({ status: "paid", principal: "0", paymentsRemaining: 0, nextDueIso: null, payoffAmount: null });
    await expect(samples.payDue(loan.loanId)).rejects.toMatchObject({ status: 409 });
    expect((await apply("alice", "200")).status).toBe("pending_review");
    await expect(samples.application(999)).rejects.toMatchObject({ status: 404 });
  });
});
