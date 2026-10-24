import { BrokerApp } from "./pages/broker/BrokerApp";

export function App() {
  if (window.location.pathname.startsWith("/broker")) return <BrokerApp />;

  return (
    <main className="entry-page">
      <div className="product-lockup"><span className="product-mark" aria-hidden="true"><span /></span><span>XRPL Lending</span></div>
      <h1>Lending on the XRP Ledger</h1>
      <p>The event repository is ready. Open the broker workspace to review the V2 operations dashboard.</p>
      <a className="button button--primary" href="/broker">Open broker workspace</a>
    </main>
  );
}
