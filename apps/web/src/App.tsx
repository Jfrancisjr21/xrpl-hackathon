import { useState } from "react";
import type { DemoWallet } from "@hack/shared";
import { api } from "./lib/api";
import { usePoll } from "./lib/hooks";
import { ErrorBanner } from "./components/ErrorBanner";
import { DepositorScreen } from "./pages/depositor/DepositorScreen";
import { BorrowerScreen } from "./pages/borrower/BorrowerScreen";
import { BrokerApp } from "./pages/broker/BrokerApp";

type Tab = "depositor" | "borrower" | "broker";
const TABS: { id: Tab; label: string }[] = [
  { id: "depositor", label: "Depositor" },
  { id: "borrower", label: "Borrower" },
  { id: "broker", label: "Broker" },
];

export function App() {
  // /broker still opens the broker workspace directly.
  const [tab, setTab] = useState<Tab>(() => (window.location.pathname.startsWith("/broker") ? "broker" : "depositor"));
  const wallets = usePoll(api.wallets, [], 0);
  const health = usePoll(api.health, [], 10_000);
  const [borrower, setBorrower] = useState<DemoWallet | null>(null);

  const depositor = wallets.data?.find((w) => w.role === "depositor") ?? null;
  const h = health.data;

  return (
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
        <span className="shell-net" role="status">
          {h ? `XRPL ${h.network ?? "Devnet"} · vault ${h.vaultPhase ?? "starting"}${h.mockMode ? " · mock ledger" : ""}`
            : health.loading ? "Connecting…" : "API offline"}
        </span>
      </header>
      {/* R5: all three tabs stay mounted and are hidden, so switching never loses a picked wallet, typed text or the broker key. */}
      <main>
        <section className="shell-main" hidden={tab !== "depositor"}>
          <ErrorBanner error={wallets.error} onRetry={wallets.refresh} />
          <DepositorScreen wallet={depositor} />
        </section>
        <section className="shell-main" hidden={tab !== "borrower"}>
          <BorrowerScreen wallets={wallets.data ?? []} wallet={borrower} onSelect={setBorrower} />
        </section>
        <section hidden={tab !== "broker"}>
          <BrokerApp />
        </section>
      </main>
    </div>
  );
}
