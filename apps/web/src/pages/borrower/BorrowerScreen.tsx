import type { ApplicationView, DemoWallet, LoanView } from "@hack/shared";
import { api } from "../../lib/api";
import { usePoll } from "../../lib/hooks";
import { ASSET, amount, pct } from "../../lib/format";
import { useWallet } from "../../lib/wallet";
import { ErrorBanner } from "../../components/ErrorBanner";
import { WalletPicker } from "./WalletPicker";
import { ApplyForm } from "./ApplyForm";
import { DecisionCard } from "./DecisionCard";
import { StatusTimeline } from "./StatusTimeline";
import { MyLoan } from "./MyLoan";
import { ScorePassport } from "./ScorePassport";
import { ENDED, STEPS, WAITING, latestOf, timelineOf } from "./status";
import { isOpen, isOverdue, pickLoan } from "./loan";

/** One sentence under the title: where this borrower stands and what happens next. */
function standing(b: DemoWallet | null, latest: ApplicationView | null, loan: LoanView | null, canApply: boolean, loansOpenAt: string | null) {
  if (!b) return "Pick a demo borrower to apply for a loan.";
  if (loan && isOpen(loan)) return loan.status === "impaired" || isOverdue(loan) ? `${b.label}'s payment is late. Pay now to avoid default.` : `${b.label} has an active loan.`;
  if (latest && WAITING.includes(latest.status)) return `Waiting for the broker to review ${b.label}'s application. This updates on its own.`;
  if (canApply && loansOpenAt) return "Loans open when the vault's deposit window closes.";
  if (latest && ENDED.includes(latest.status)) return `${timelineOf(latest).note ?? "The last application ended."} ${b.label} can apply again.`;
  if (loan?.status === "paid") return `${b.label} has paid off their loan.`;
  return `Apply for a loan as ${b.label}.`;
}

/** Beside the decision while the broker reviews: what happens now, and the terms asked for. */
function NextStep({ app }: { app: ApplicationView }) {
  const d = app.decision;
  return (
    <section className="panel" aria-labelledby="next-title">
      <div className="panel-header"><h2 id="next-title">Next step</h2></div>
      <p className="panel-sub">
        {app.status === "originating"
          ? "Approved. The loan is being created on the ledger with two signatures, the broker's and yours. This takes about 10 seconds."
          : "A person on the broker's desk reviews the agent's recommendation. No money moves until they approve it."}
      </p>
      <dl className="kv">
        <div><dt>Amount asked for</dt><dd className="num">{amount(app.amount)} {ASSET}</dd></div>
        <div><dt>Payments</dt><dd className="num">{app.paymentTotal}</dd></div>
        <div><dt>Offered rate</dt><dd className="num">{d.interestRate !== null ? `${pct(d.interestRate)} a year` : "—"}</dd></div>
        <div><dt>Level</dt><dd>{d.approvalLevel ?? "—"}</dd></div>
      </dl>
    </section>
  );
}

// Pick a borrower, apply, follow the application, then pay the loan. The picker and the sidebar switcher set the same wallet.
export function BorrowerScreen() {
  const { wallets, wallet, setWallet } = useWallet();
  const borrower = wallet && wallet.role !== "depositor" ? wallet : null;
  const vault = usePoll(() => api.vault(), [], 5000);
  // Polled every 3 s so the steps move on their own while the broker reviews.
  const apps = usePoll(() => (borrower ? api.myApplications(borrower.address) : Promise.resolve([])), [borrower?.address], 3000);
  const loans = usePoll(() => (borrower ? api.loans(borrower.address) : Promise.resolve([])), [borrower?.address], 5000);
  const latest = latestOf(apps.data);
  const loan = pickLoan(loans.data);
  const assetLabel = ASSET;
  const loansOpenAt = vault.data?.phase === "subscription" ? vault.data.subscriptionDate : null;
  // A new application once the last one ended without a loan, or its loan is paid off or defaulted.
  const loanClosed = latest?.status === "active" && loan?.applicationId === latest.id && !isOpen(loan);
  const canApply = !latest || ENDED.includes(latest.status) || loanClosed;
  const showDecision = !!latest && !loanClosed;
  const refreshAll = async () => { await Promise.all([apps.refresh(), loans.refresh()]); };

  // Left: what the borrower acts on (the loan to pay, or the form). Right: what the system said (passport, decision).
  const left = borrower && (
    <>
      {loan && (
        <MyLoan key={loan.loanId} loan={loan} assetLabel={assetLabel} onPaid={refreshAll}
          paymentTotal={apps.data?.find((a) => a.id === loan.applicationId)?.paymentTotal ?? null} />
      )}
      {canApply && <ApplyForm key={`apply-${borrower.address}`} address={borrower.address} assetLabel={assetLabel} loansOpenAt={loansOpenAt} onApplied={refreshAll} />}
    </>
  );
  const hasRight = !!loan || showDecision;
  const waiting = !loan && !canApply && !!latest && WAITING.includes(latest.status);

  return (
    <div className="screen-page screen">
      <header className="page-header">
        <div><h1>Borrow</h1><p>{standing(borrower, latest, loan, canApply, loansOpenAt)}</p></div>
      </header>
      <WalletPicker wallets={wallets} selected={borrower} onSelect={setWallet} />
      {!borrower && (
        <div className="timeline-wrap">
          <ol className="timeline" aria-label="What happens after you apply">
            {STEPS.map((step) => <li key={step} className="step step--todo"><span className="step-dot" aria-hidden="true" /><span>{step}</span></li>)}
          </ol>
          <p className="hint">Every application goes through these steps. Each demo borrower above ends differently: approved, priced higher, offered a starter loan, or blocked.</p>
        </div>
      )}
      {borrower && (
        <>
          <ErrorBanner error={apps.error && `Couldn't load ${borrower.label}'s applications. ${apps.error}`} onRetry={apps.refresh} />
          <ErrorBanner error={loans.error && `Couldn't load ${borrower.label}'s loans. ${loans.error}`} onRetry={loans.refresh} />
          {showDecision && latest && <StatusTimeline app={latest} />}
          <div className={hasRight && (loan || canApply || waiting) ? "pair-grid pair-grid--top" : "single-column"}>
            {(loan || canApply) && <div className="stack">{left}</div>}
            {waiting && latest && <div className="stack"><NextStep app={latest} /></div>}
            {hasRight && (
              <div className="stack">
                {loan && <ScorePassport address={borrower.address} />}
                {showDecision && latest && <DecisionCard app={latest} assetLabel={assetLabel} onReapplied={refreshAll} />}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
