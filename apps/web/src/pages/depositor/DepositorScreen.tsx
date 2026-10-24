import { useEffect, useState } from "react";
import type { TxResult, VaultView } from "@hack/shared";
import { api } from "../../lib/api";
import { usePoll, useTx } from "../../lib/hooks";
import { useWallet } from "../../lib/wallet";
import { amount, date, isAmount } from "../../lib/format";
import { ErrorBanner } from "../../components/ErrorBanner";
import { PhaseBanner } from "../../components/PhaseBanner";
import { Stat } from "../../components/Stat";
import { TxReceipt } from "../../components/TxReceipt";
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
  const { wallet } = useWallet();
  const vault = usePoll<VaultView>(() => api.vault(wallet?.address), [wallet?.address]);
  const now = useClock(vault.data?.phase === "subscription");

  if (vault.loading && !vault.data) return <p className="hint">Loading the vault…</p>;
  if (!vault.data || !wallet) {
    return <ErrorBanner error={vault.error ? `Couldn't load the vault. ${vault.error}` : "No wallet to act as yet."} onRetry={vault.refresh} />;
  }
  const v = vault.data;

  return (
    <div className="screen">
      <h1>Earn yield on {v.assetLabel}</h1>
      <p className="lead">Depositors fund a shared vault. Approved borrowers take loans from it and pay interest; the platform keeps 10% of that interest and depositors earn the rest.</p>
      <PhaseBanner vault={v} />
      <ErrorBanner error={vault.error && `Couldn't refresh the vault; showing the last figures. ${vault.error}`} onRetry={vault.refresh} />
      <div className="stats">
        <Stat label="Total in vault" value={amount(v.assetsTotal)} unit={v.assetLabel} />
        <Stat label="Available to lend" value={amount(v.assetsAvailable)} unit={v.assetLabel} />
        <Stat label="Lent out" value={`${v.utilizationPct.toFixed(1)}%`} />
      </div>
      <section className="card" aria-label="Your position">
        <h2>{wallet.label}'s position</h2>
        <p className="num">{amount(v.position?.deposited)} {v.assetLabel} · {(v.position?.sharePct ?? 0).toFixed(1)}% of the vault</p>
      </section>
      {/* Keyed by wallet: switching wallets starts a fresh form, so no amount, error or receipt carries over. */}
      <MoveForm key={wallet.address} vault={v} address={wallet.address} label={wallet.label} now={now} onDone={vault.refresh} />
      {v.lossUnrealized !== "0" && <p className="warn">Unrealized loss from impaired loans: {amount(v.lossUnrealized)} {v.assetLabel}</p>}
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
    <section className="card move" aria-label="Deposit or withdraw">
      <h2>Deposit or withdraw</h2>
      <label className="field">
        <span>Amount</span>
        <span className="field-input">
          <input
            inputMode="numeric" autoComplete="off" placeholder="100" value={value} disabled={tx.pending}
            aria-invalid={invalid} aria-describedby="move-help"
            onChange={(e) => setValue(e.target.value.trim())}
          />
          <small>{v.assetLabel}</small>
        </span>
      </label>
      <p id="move-help" className={invalid ? "help help--error" : "help"}>
        {invalid ? `Enter a whole number of ${v.assetLabel}, like 100.` : `Whole ${v.assetLabel} only.`}
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
      {!locks.withdraw && overPosition && <p className="hint">{label} has {amount(held)} {v.assetLabel} in the vault to withdraw.</p>}
      <ErrorBanner error={tx.error} />
      <TxReceipt tx={tx.result} />
    </section>
  );
}
