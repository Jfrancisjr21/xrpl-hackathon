import { useState } from "react";
import { api } from "./lib/api";
import { usePoll } from "./lib/hooks";
import { WalletProvider } from "./lib/wallet";
import { ErrorBanner } from "./components/ErrorBanner";
import { WalletSwitcher } from "./components/WalletSwitcher";
import { DepositorScreen } from "./pages/depositor/DepositorScreen";
import { BorrowerScreen } from "./pages/borrower/BorrowerScreen";
import { BrokerApp } from "./pages/broker/BrokerApp";

type Tab = "depositor" | "borrower";
const TABS: { id: Tab; label: string }[] = [
  { id: "depositor", label: "Lender" },
  { id: "borrower", label: "Borrower" },
];

export function App() {
  if (window.location.pathname.startsWith("/broker")) return <BrokerApp />;
  return <UserApp />;
}

function UserApp() {
  const [tab, setTab] = useState<Tab>("depositor");
  const wallets = usePoll(api.wallets, [], 0);
  const health = usePoll(api.health, [], 10_000);
  const h = health.data;

  return (
    <WalletProvider wallets={wallets.data ?? []}>
      <div className="shell">
        <header className="shell-bar">
          <div className="product-lockup"><span className="product-mark" aria-hidden="true"><span /></span><span>XRPL Lending</span></div>
          <nav className="shell-tabs" aria-label="Screens">
            {TABS.map((t) => (
              <button key={t.id} type="button" className="shell-tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <WalletSwitcher />
          <span className="shell-net" role="status">
            {h ? `XRPL ${h.network ?? "Devnet"} · vault ${h.vaultPhase ?? "starting"}${h.mockMode ? " · mock ledger" : ""}`
              : health.loading ? "Connecting…" : "API offline"}
          </span>
        </header>
        {/* Both user tabs stay mounted so switching never loses typed text.
            The active wallet lives in WalletProvider and survives reloads too. */}
        <main>
          <section className="shell-main" hidden={tab !== "depositor"}>
            <ErrorBanner error={wallets.error && `Couldn't load the demo wallets. ${wallets.error}`} onRetry={wallets.refresh} />
            <DepositorScreen />
          </section>
          <section className="shell-main" hidden={tab !== "borrower"}>
            <BorrowerScreen />
          </section>
        </main>
      </div>
    </WalletProvider>
  );
}
