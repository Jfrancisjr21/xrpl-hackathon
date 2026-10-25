import type { LoanView } from "@hack/shared";
import { describe, expect, it } from "vitest";
import { samples } from "../../samples";
import { isOverdue, pickLoan, scheduleOf } from "./loan";

const now = Date.parse("2026-10-24T15:00:00Z");
const loan = (over: Partial<LoanView>): LoanView => ({ ...samples.loan, nextDueIso: new Date(now + 60_000).toISOString(), ...over });

describe("pickLoan", () => {
  it("prefers the open loan over a newer closed one (R9)", () => {
    const paid = loan({ loanId: "B", status: "paid" });
    const open = loan({ loanId: "A", status: "impaired" });
    expect(pickLoan([paid, open])?.loanId).toBe("A");
    expect(pickLoan([paid])?.loanId).toBe("B");
    expect(pickLoan([])).toBeNull();
  });
});

describe("isOverdue", () => {
  it("is late when the ledger says so or the due date has passed", () => {
    expect(isOverdue(loan({}), now)).toBe(false);
    expect(isOverdue(loan({ canImpair: true }), now)).toBe(true);
    expect(isOverdue(loan({ nextDueIso: new Date(now - 1000).toISOString() }), now)).toBe(true);
    expect(isOverdue(loan({ status: "paid", canImpair: true }), now)).toBe(false);
  });
});

describe("scheduleOf", () => {
  it("lists the remaining due dates one 60-second interval apart", () => {
    const dates = scheduleOf(loan({ paymentsRemaining: 3 })).map(Date.parse);
    expect(dates).toEqual([now + 60_000, now + 120_000, now + 180_000]);
    expect(scheduleOf(loan({ status: "paid", paymentsRemaining: 0, nextDueIso: null }))).toEqual([]);
  });
});
