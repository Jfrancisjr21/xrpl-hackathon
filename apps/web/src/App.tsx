import { BrandLogo } from "./components/BrandLogo";
import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { usePoll } from "./lib/hooks";
import { ThemeToggle } from "./components/ThemeToggle";
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
const PHASE: Record<string, string> = { subscription: "deposit window", investment: "lending", redemption: "withdrawals open" };

export function App() {
  if (window.location.pathname.startsWith("/broker")) return <BrokerApp />;
  return <UserApp />;
}

function UserApp() {
  // #borrower opens the Borrower screen, so the broker dashboard can link straight to it.
  const [tab, setTab] = useState<Tab>(() => (window.location.hash === "#borrower" ? "borrower" : "depositor"));
  const [menuOpen, setMenuOpen] = useState(false);
  // Typing or following #borrower on an open page changes only the hash, so follow it here too.
  useEffect(() => {
    const onHash = () => setTab(window.location.hash === "#borrower" ? "borrower" : "depositor");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const wallets = usePoll(api.wallets, [], 0);
  const health = usePoll(api.health, [], 10_000);
  const h = health.data;

  const select = (t: Tab) => {
    setTab(t);
    setMenuOpen(false);
    window.history.replaceState(null, "", t === "borrower" ? "#borrower" : window.location.pathname);
  };

  return (
    <WalletProvider wallets={wallets.data ?? []}>
      <div className="app-shell">
        <header className="mobile-header">
          <button type="button" onClick={() => setMenuOpen(true)}>Menu</button>
          <BrandLogo />
        </header>
        <aside className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}>
          <button className="sidebar-close" type="button" onClick={() => setMenuOpen(false)}>Close</button>
          <BrandLogo />
          <div className="workspace-label"><span>Workspace</span><strong>Devnet demo</strong></div>
          <nav aria-label="Screens">
            <p className="nav-group">Lend and borrow</p>
            {TABS.map((t) => (
              <button key={t.id} type="button" className={tab === t.id ? "nav-item nav-item--active" : "nav-item"} aria-current={tab === t.id ? "page" : undefined} onClick={() => select(t.id)}>
                <span>{t.label}</span>
              </button>
            ))}
            <p className="nav-group">Operations</p>
            <a className="nav-item" href="/broker"><span>Broker dashboard</span></a>
          </nav>
          {tab === "borrower" && <WalletSwitcher />}
          <div className="sidebar-foot">
            <div className="sidebar-meta" role="status">
              <span className={h ? "signal-dot signal-dot--ok" : "signal-dot"} />
              {h ? `XRPL ${h.network ?? "Devnet"}${h.mockMode ? " · mock ledger" : ""}` : health.loading ? "Connecting…" : "API offline"}
              <small>{h ? `Vault: ${PHASE[h.vaultPhase ?? ""] ?? "starting"}` : "Retrying every 10 seconds"}</small>
            </div>
            <ThemeToggle />
          </div>
        </aside>
        {menuOpen ? <button className="menu-scrim" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}
        {/* Both user screens stay mounted so switching never loses typed text.
            The active wallet lives in WalletProvider and survives reloads too. */}
        <main className="canvas">
          <section hidden={tab !== "depositor"}>
            <ErrorBanner error={wallets.error && `Couldn't load the demo wallets. ${wallets.error}`} onRetry={wallets.refresh} />
            <DepositorScreen />
          </section>
          <section hidden={tab !== "borrower"}>
            <BorrowerScreen />
          </section>
        </main>
      </div>
    </WalletProvider>
  );
}
