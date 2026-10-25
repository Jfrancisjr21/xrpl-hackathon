import type { LoanView } from "@hack/shared";

// The server sets the payment interval; with DEMO_FAST_LOANS (the demo's setting) it is 60 seconds.
export const DEMO_INTERVAL_SEC = 60;

export const isOpen = (l: LoanView) => l.status === "active" || l.status === "impaired";

/** R9: the loan that matters is the open one, not just the newest row. */
export const pickLoan = (loans: LoanView[] | null) => (loans ?? []).find(isOpen) ?? loans?.[0] ?? null;

/** A payment is late: the ledger says so (canImpair), or the due date has passed on this clock. */
export function isOverdue(l: LoanView, now = Date.now()) {
  if (!isOpen(l)) return false;
  const due = l.nextDueIso ? Date.parse(l.nextDueIso) : NaN;
  return l.canImpair || (!Number.isNaN(due) && due < now);
}

/** The remaining due dates, one interval apart from the next one. */
export function scheduleOf(l: LoanView, intervalSec = DEMO_INTERVAL_SEC): string[] {
  const first = l.nextDueIso ? Date.parse(l.nextDueIso) : NaN;
  if (!isOpen(l) || Number.isNaN(first) || !l.paymentsRemaining) return [];
  return Array.from({ length: l.paymentsRemaining }, (_, i) => new Date(first + i * intervalSec * 1000).toISOString());
}
