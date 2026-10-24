import type { DemoWallet, VaultView } from "@hack/shared";
import { api } from "../../lib/api";
import { usePoll } from "../../lib/hooks";
import { amount } from "../../lib/format";
import { ErrorBanner } from "../../components/ErrorBanner";
import { PhaseBanner } from "../../components/PhaseBanner";
import { Stat } from "../../components/Stat";

// Phase 1 frame: the vault and this wallet's position. Phase 2 adds the deposit and withdraw forms.
export function DepositorScreen({ wallet }: { wallet: DemoWallet | null }) {
  const vault = usePoll<VaultView>(() => api.vault(wallet?.address), [wallet?.address]);

  if (vault.loading && !vault.data) return <p className="hint">Loading the vault…</p>;
  if (!vault.data || !wallet) return <ErrorBanner error={vault.error ?? "No depositor wallet"} onRetry={vault.refresh} />;
  const v = vault.data;

  return (
    <div className="screen">
      <h1>Earn yield on {v.assetLabel}</h1>
      <p className="lead">Depositors fund a shared vault. Approved borrowers take loans from it and pay interest; the platform keeps 10% of that interest and depositors earn the rest.</p>
      <PhaseBanner vault={v} />
      <ErrorBanner error={vault.error} onRetry={vault.refresh} />
      <div className="stats">
        <Stat label="Total in vault" value={amount(v.assetsTotal)} unit={v.assetLabel} />
        <Stat label="Available to lend" value={amount(v.assetsAvailable)} unit={v.assetLabel} />
        <Stat label="Lent out" value={`${v.utilizationPct.toFixed(1)}%`} />
      </div>
      <section className="card" aria-label="Your position">
        <h2>Your position</h2>
        <p className="num">{amount(v.position?.deposited)} {v.assetLabel} · {(v.position?.sharePct ?? 0).toFixed(1)}% of the vault</p>
      </section>
    </div>
  );
}
