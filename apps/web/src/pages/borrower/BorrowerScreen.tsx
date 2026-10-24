import { api } from "../../lib/api";
import { usePoll } from "../../lib/hooks";
import { useWallet } from "../../lib/wallet";
import { ErrorBanner } from "../../components/ErrorBanner";
import { WalletPicker } from "./WalletPicker";
import { ApplyForm } from "./ApplyForm";
import { DecisionCard } from "./DecisionCard";
import { StatusTimeline } from "./StatusTimeline";
import { ENDED, WAITING, latestOf } from "./status";

// Phase 3: pick a borrower, apply, see the decision and follow the application. Phase 4 adds the loan.
// The picker and the header switcher set the same active wallet.
export function BorrowerScreen() {
  const { wallets, wallet, setWallet } = useWallet();
  const borrower = wallet && wallet.role !== "depositor" ? wallet : null;
  const vault = usePoll(() => api.vault(), [], 5000);
  // Polled every 3 s so the timeline moves on its own while the broker reviews.
  const apps = usePoll(() => (borrower ? api.myApplications(borrower.address) : Promise.resolve([])), [borrower?.address], 3000);
  const latest = latestOf(apps.data);
  const assetLabel = vault.data?.assetLabel ?? "";
  const loansOpenAt = vault.data?.phase === "subscription" ? vault.data.subscriptionDate : null;

  return (
    <div className="screen">
      <h1>Borrow simulated XRP</h1>
      <WalletPicker wallets={wallets} selected={borrower} onSelect={setWallet} />
      {!borrower ? <p className="hint">Pick a borrower to start.</p> : (
        <>
          <ErrorBanner error={apps.error && `Couldn't load ${borrower.label}'s applications. ${apps.error}`} onRetry={apps.refresh} />
          {(!latest || ENDED.includes(latest.status)) && (
            <ApplyForm key={borrower.address} address={borrower.address} assetLabel={assetLabel} loansOpenAt={loansOpenAt} onApplied={apps.refresh} />
          )}
          {latest && <StatusTimeline app={latest} />}
          {latest && WAITING.includes(latest.status) && <p className="hint">Waiting for the broker… this updates on its own.</p>}
          {latest && <DecisionCard app={latest} assetLabel={assetLabel} />}
        </>
      )}
    </div>
  );
}
