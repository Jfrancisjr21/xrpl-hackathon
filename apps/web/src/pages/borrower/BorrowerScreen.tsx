import { api } from "../../lib/api";
import { usePoll } from "../../lib/hooks";
import { useWallet } from "../../lib/wallet";
import { ErrorBanner } from "../../components/ErrorBanner";
import { WalletPicker } from "./WalletPicker";
import { ApplyForm } from "./ApplyForm";
import { DecisionCard } from "./DecisionCard";
import { StatusTimeline } from "./StatusTimeline";
import { MyLoan } from "./MyLoan";
import { ENDED, WAITING, latestOf } from "./status";
import { isOpen, pickLoan } from "./loan";

// Phase 3 and 4: pick a borrower, apply, follow the application, then pay the loan.
// The picker and the header switcher set the same active wallet.
export function BorrowerScreen() {
  const { wallets, wallet, setWallet } = useWallet();
  const borrower = wallet && wallet.role !== "depositor" ? wallet : null;
  const vault = usePoll(() => api.vault(), [], 5000);
  // Polled every 3 s so the timeline moves on its own while the broker reviews.
  const apps = usePoll(() => (borrower ? api.myApplications(borrower.address) : Promise.resolve([])), [borrower?.address], 3000);
  const loans = usePoll(() => (borrower ? api.loans(borrower.address) : Promise.resolve([])), [borrower?.address], 5000);
  const latest = latestOf(apps.data);
  const loan = pickLoan(loans.data);
  const assetLabel = vault.data?.assetLabel ?? "";
  const loansOpenAt = vault.data?.phase === "subscription" ? vault.data.subscriptionDate : null;
  // A new application once the last one ended without a loan, or its loan is paid off or defaulted.
  const loanClosed = latest?.status === "active" && loan?.applicationId === latest.id && !isOpen(loan);
  const canApply = !latest || ENDED.includes(latest.status) || loanClosed;
  const refreshAll = async () => { await Promise.all([apps.refresh(), loans.refresh()]); };

  return (
    <div className="screen">
      <h1>Borrow simulated XRP</h1>
      <WalletPicker wallets={wallets} selected={borrower} onSelect={setWallet} />
      {!borrower ? <p className="hint">Pick a borrower to start.</p> : (
        <>
          <ErrorBanner error={apps.error && `Couldn't load ${borrower.label}'s applications. ${apps.error}`} onRetry={apps.refresh} />
          <ErrorBanner error={loans.error && `Couldn't load ${borrower.label}'s loans. ${loans.error}`} onRetry={loans.refresh} />
          {loan && (
            <MyLoan key={loan.loanId} loan={loan} assetLabel={assetLabel} onPaid={refreshAll}
              paymentTotal={apps.data?.find((a) => a.id === loan.applicationId)?.paymentTotal ?? null} />
          )}
          {canApply && (
            <ApplyForm key={`apply-${borrower.address}`} address={borrower.address} assetLabel={assetLabel} loansOpenAt={loansOpenAt} onApplied={refreshAll} />
          )}
          {latest && !loanClosed && <StatusTimeline app={latest} />}
          {latest && WAITING.includes(latest.status) && <p className="hint">Waiting for the broker… this updates on its own.</p>}
          {latest && !loanClosed && <DecisionCard app={latest} assetLabel={assetLabel} />}
        </>
      )}
    </div>
  );
}
