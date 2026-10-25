import type { LedgerService } from "@hack/ledger";
import type { Alert } from "@hack/shared";
import { audit, closeLoan, listApplications, type Db } from "../db/db";

// Feature 2: watches every loan we originated and raises an alert when a payment is overdue,
// so the broker sees "Payment overdue" before impairing. Alerts are kept in memory: they describe
// the current state and are rebuilt within one tick after a restart.
export function createMonitor({ db, ledger }: { db: Db; ledger: LedgerService }) {
  const alerts = new Map<string, Alert>(); // by loan id
  let running = false;
  let timer: NodeJS.Timeout | undefined;

  async function tick(now = new Date()): Promise<void> {
    if (running) return; // the previous check is still waiting on the ledger
    running = true;
    try {
      const open = listApplications(db).filter((a) => a.loan_id && !a.loan_outcome);
      const stillOverdue = new Set<string>();
      for (const a of open) {
        const loan = await ledger.getLoan(a.loan_id!).catch(() => null); // gone or unreachable: try again next tick
        if (!loan) {
          if (alerts.has(a.loan_id!)) stillOverdue.add(a.loan_id!); // keep the alert through a failed read instead of flickering
          continue;
        }
        if (loan.status === "paid" || loan.status === "defaulted") {
          closeLoan(db, loan.loanId, loan.status); // ended outside our routes (e.g. a script); a default still bans
          continue;
        }
        if (loan.nextDueIso && now.getTime() > Date.parse(loan.nextDueIso)) {
          stillOverdue.add(loan.loanId);
          const previous = alerts.get(loan.loanId);
          // One audit row when a loan first goes overdue, not one per tick.
          if (!previous) audit(db, { actor: "system", action: "payment_overdue", applicationId: a.id, loanId: loan.loanId, note: `due ${loan.nextDueIso}` });
          alerts.set(loan.loanId, {
            loanId: loan.loanId,
            borrower: loan.borrower,
            kind: "overdue",
            nextDueIso: loan.nextDueIso,
            detectedAt: previous?.detectedAt ?? now.toISOString(), // when it first went overdue, not every tick
          });
        }
      }
      for (const id of alerts.keys()) if (!stillOverdue.has(id)) alerts.delete(id); // paid, ended or caught up
    } finally {
      running = false;
    }
  }

  return {
    tick,
    alerts: (): Alert[] => [...alerts.values()].sort((x, y) => x.detectedAt.localeCompare(y.detectedAt)),
    start(intervalMs = 10_000) {
      timer = setInterval(() => void tick().catch((e) => console.error("monitor:", e)), intervalMs);
      void tick();
    },
    stop() {
      clearInterval(timer);
    },
  };
}

export type Monitor = ReturnType<typeof createMonitor>;
