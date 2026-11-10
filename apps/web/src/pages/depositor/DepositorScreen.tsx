import { useEffect, useState } from "react";
import type { TxResult, VaultView } from "@hack/shared";
import { api } from "../../lib/api";
import { usePoll, useTx } from "../../lib/hooks";
import { useWallet } from "../../lib/wallet";
import { ASSET, amount, date, isAmount } from "../../lib/format";
import { ErrorBanner } from "../../components/ErrorBanner";
import { TxReceipt } from "../../components/TxReceipt";
import { PhaseSentence, VaultTimeline, when } from "../../components/VaultTimeline";
import { depositorLocks } from "./locks";

/** Re-renders every second while the deposit window is open, so the form closes when the countdown hits zero. */
function useClock(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return now;
}

export function DepositorScreen() {
  // The Lender tab always acts as the depositor, whatever borrower the header switcher has picked.
  const { wallets } = useWallet();
  const wallet = wallets.find((w) => w.role === "depositor") ?? null;
  const vault = usePoll<VaultView>(() => api.vault(wallet?.address), [wallet?.address]);
  const now = useClock(vault.data?.phase === "subscription");

  if (vault.loading && !vault.data) return <p className="hint">Loading the vault…</p>;
  if (!vault.data || !wallet) {
    return <ErrorBanner error={vault.error ? `Couldn't load the vault. ${vault.error}` : "No depositor wallet yet."} onRetry={vault.refresh} />;
  }
  const v = vault.data;
  const share = v.position?.sharePct ?? 0;
  // Whole numbers from the ledger, so the subtraction is exact.
  const lent = Math.max(0, Number(v.assetsTotal) - Number(v.assetsAvailable));

  return (
    <div className="screen-page">
      <header className="page-header">
        <div><h1>Vault</h1><p><PhaseSentence vault={v} /></p></div>
      </header>
      <ErrorBanner error={vault.error && `Couldn't refresh the vault; showing the last figures. ${vault.error}`} onRetry={vault.refresh} />
      <VaultTimeline vault={v} />
      {/* Two equal columns on the canvas: 2 x 1fr + 1 gutter. Position (the answer) on the left, the action beside it. */}
      <div className="pair-grid">
        <section className="panel position-panel" aria-labelledby="position-title">
          <div className="panel-header"><h2 id="position-title">Your position</h2><span className="status status--neutral">{wallet.label}</span></div>
          <p className="lead-figure num">{amount(v.position?.deposited)}<small> {ASSET}</small></p>
          <p className="panel-sub num">{share.toFixed(1)}% of the vault</p>
          <div className="share-track" role="img" aria-label={`${share.toFixed(1)}% of the vault`}><span style={{ width: `${Math.min(100, share)}%` }} /></div>
          <dl className="kv">
            <div><dt>Deposits</dt><dd>{v.phase === "subscription" ? `Open until ${when(v.subscriptionDate)}` : v.phase === "investment" ? "Closed while the vault lends" : "Closed · next vault"}</dd></div>
            <div><dt>Withdrawals</dt><dd>{v.phase === "investment" ? `Open from ${when(v.redemptionDate)}` : "Open now"}</dd></div>
          </dl>
          <p className="panel-note">Lenders earn 90% of the interest borrowers pay. Confiance keeps 10%.</p>
        </section>
        {/* Keyed by wallet: switching wallets starts a fresh form, so no amount, error or receipt carries over. */}
        <MoveForm key={wallet.address} vault={v} address={wallet.address} label={wallet.label} now={now} onDone={vault.refresh} />
      </div>
      <section className="panel" aria-labelledby="vault-title">
        <div className="panel-header"><h2 id="vault-title">The vault</h2><span className="panel-meta">Shared by every lender</span></div>
        <div className="metric-strip metric-strip--bare">
          <div className="metric"><span>Total in vault</span><strong className="num">{amount(v.assetsTotal)}<small> {ASSET}</small></strong></div>
          <div className="metric"><span>Available to lend</span><strong className="num">{amount(v.assetsAvailable)}<small> {ASSET}</small></strong></div>
          <div className="metric"><span>Lent out</span><strong className="num">{v.utilizationPct.toFixed(1)}%<small> · {amount(String(lent))} {ASSET}</small></strong></div>
        </div>
        <div className="share-track share-track--wide" role="img" aria-label={`${v.utilizationPct.toFixed(1)}% of the vault lent out`}><span style={{ width: `${Math.min(100, v.utilizationPct)}%` }} /></div>
        {v.lossUnrealized !== "0" && <p className="warn">Unrealized loss from impaired loans: {amount(v.lossUnrealized)} {ASSET}</p>}
      </section>
    </div>
  );
}

function MoveForm({ vault: v, address, label, now, onDone }: {
  vault: VaultView; address: string; label: string; now: number; onDone: () => Promise<void>;
}) {
  const tx = useTx<TxResult>();
  const [value, setValue] = useState("");
  const locks = depositorLocks(v, now);
  const invalid = value !== "" && !isAmount(value);
  // Whole numbers on both sides, so comparing as numbers is exact. The ledger enforces it anyway.
  const held = v.position?.deposited ?? "0";
  const overPosition = isAmount(value) && Number(value) > Number(held);

  // R1: re-fetch the vault and position after every transaction.
  const move = (kind: "deposit" | "withdraw") =>
    tx.run(() => api[kind](address, value), async () => { setValue(""); await onDone(); });

  return (
    <section className="panel move" aria-labelledby="move-title">
      <div className="panel-header"><h2 id="move-title">Deposit or withdraw</h2></div>
      <label className="field">
        <span>Amount</span>
        <span className="field-input">
          <input
            inputMode="numeric" autoComplete="off" placeholder="100" value={value} disabled={tx.pending}
            aria-invalid={invalid} aria-describedby="move-help"
            onChange={(e) => setValue(e.target.value.trim())}
          />
          <small>{ASSET}</small>
        </span>
      </label>
      <p id="move-help" className={invalid ? "help help--error" : "help"}>
        {invalid ? `Enter a whole number of ${ASSET}, like 100.` : `Whole ${ASSET} only.`}
      </p>
      <div className="move-actions">
        <button type="button" className="button button--primary" disabled={!!locks.deposit || !isAmount(value) || tx.pending} onClick={() => move("deposit")}>
          {tx.pending ? "Confirming on Devnet…" : "Deposit"}
        </button>
        <button type="button" className="button button--secondary" disabled={!!locks.withdraw || !isAmount(value) || overPosition || tx.pending} onClick={() => move("withdraw")}>
          Withdraw
        </button>
      </div>
      {locks.deposit && <p className="hint">{locks.deposit}</p>}
      {locks.withdraw && <p className="hint">{locks.withdraw}{v.redemptionDate ? ` (${date(v.redemptionDate)})` : ""}</p>}
      {!locks.withdraw && overPosition && <p className="hint">{label} has {amount(held)} {ASSET} in the vault to withdraw.</p>}
      <ErrorBanner error={tx.error} />
      <TxReceipt tx={tx.result} />
    </section>
  );
}
