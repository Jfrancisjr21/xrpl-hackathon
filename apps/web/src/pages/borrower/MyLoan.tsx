import type { LoanView, PayResult } from "@hack/shared";
import { api } from "../../lib/api";
import { useTx } from "../../lib/hooks";
import { amount, date, pct } from "../../lib/format";
import { Countdown } from "../../components/Countdown";
import { ErrorBanner } from "../../components/ErrorBanner";
import { StatusBadge } from "../../components/StatusBadge";
import { TxReceipt } from "../../components/TxReceipt";
import { isOpen, isOverdue, scheduleOf } from "./loan";

const LABEL: Record<LoanView["status"], string> = { active: "Active", impaired: "Impaired", defaulted: "Defaulted", paid: "Paid" };

/** The borrower's loan: what is owed, when, and one-click payments whose amount comes from the ledger (R3). */
export function MyLoan({ loan, paymentTotal, assetLabel, onPaid }: {
  loan: LoanView;
  /** From the loan's application; LoanView doesn't carry it. */
  paymentTotal: number | null;
  assetLabel: string;
  onPaid: () => Promise<void>;
}) {
  const pay = useTx<PayResult>();
  const open = isOpen(loan);
  const unit = (s: string | null) => (s === null ? "—" : `${amount(s)} ${assetLabel}`);
  const schedule = scheduleOf(loan);

  return (
    <>
      <section className="card my-loan" aria-label="My loan">
        <div className="decision-head">
          <h2>My loan</h2>
          <StatusBadge value={loan.status} label={LABEL[loan.status]} />
        </div>
        {loan.status === "impaired" && <p className="warn">Your payment is late and the broker has marked this loan impaired. Pay now to avoid default.</p>}
        {loan.status === "defaulted" && <p className="error">This loan has defaulted. The broker's first-loss cover absorbed part of the loss.</p>}
        {loan.status === "active" && isOverdue(loan) && <p className="warn">A payment is overdue.</p>}
        <dl className="loan-facts">
          <div><dt>Principal outstanding</dt><dd className="num">{unit(loan.principal)}</dd></div>
          <div><dt>Rate</dt><dd className="num">{pct(loan.interestRate)} a year</dd></div>
          <div><dt>Payments left</dt><dd className="num">{loan.paymentsRemaining ?? "—"}{paymentTotal ? ` of ${paymentTotal}` : ""}</dd></div>
          <div><dt>Next due</dt><dd className="num">{loan.nextDueIso ? <>{date(loan.nextDueIso)} (<Countdown to={loan.nextDueIso} />)</> : "—"}</dd></div>
          <div><dt>Total owed</dt><dd className="num">{unit(loan.totalOwed)}</dd></div>
        </dl>
        {open && (
          <div className="move-actions">
            <button type="button" className="button button--primary" disabled={pay.pending || !loan.installmentDue}
              onClick={() => pay.run(() => api.payDue(loan.loanId), onPaid)}>
              {pay.pending ? "Confirming on Devnet…" : `Pay amount due: ${unit(loan.installmentDue)}`}
            </button>
            <button type="button" className="button button--secondary" disabled={pay.pending || !loan.payoffAmount}
              onClick={() => pay.run(() => api.pay(loan.loanId, "payoff"), onPaid)}>
              Pay off ({unit(loan.payoffAmount)})
            </button>
          </div>
        )}
        {loan.status === "paid" && <p className="ok">Paid in full.</p>}
        <ErrorBanner error={pay.error} />
        {pay.result && <TxReceipt tx={pay.result.tx} label={`Paid ${unit(pay.result.amount)}`} />}
      </section>
      {schedule.length > 0 && (
        <section className="card schedule" aria-label="Payment schedule">
          <h2>Payment schedule</h2>
          <ol>
            {schedule.map((due) => (
              <li key={due}><span className="num">{date(due)}</span><span className="num">{unit(loan.installmentDue)}</span></li>
            ))}
          </ol>
          <p className="hint">One payment every 60 seconds in the demo.</p>
        </section>
      )}
    </>
  );
}
