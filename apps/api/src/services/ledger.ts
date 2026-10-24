import type { DemoWallet, Role, VaultPhase } from "@hack/shared";
// shortcut: deep imports because @hack/ledger's index needs xrpl-ledger.ts (Phase 5, not merged yet).
// Once it merges, implement ApiLedger with XrplLedger (getWallets, getVault().phase) instead.
import { loadWallets } from "@hack/ledger/src/wallets";
import { readState } from "@hack/ledger/src/state";
import { vaultPhase } from "@hack/ledger/src/vault";

// What the routes need from the ledger. Tests pass a fake.
export interface ApiLedger {
  getWallets(): DemoWallet[];
  getVaultPhase(): VaultPhase | null; // null until bootstrap has created the vault
}

// Shown in the wallet picker (R13). Matches the ledger's demo-profiles.ts.
const PROFILES: Record<Role, { label: string; description?: string }> = {
  issuer: { label: "Issuer", description: "Issues KYC credentials" },
  broker: { label: "Broker", description: "Owns the vault and approves loans" },
  depositor: { label: "Depositor", description: "Funds the vault" },
  agent: { label: "Agent", description: "Co-signer for two-key approval" },
  alice: { label: "Alice", description: "Strong profile — approved, low rate" },
  carol: { label: "Carol", description: "Mid-range profile — approved, higher rate" },
  bob: { label: "Bob", description: "Thin file — no credit history" },
  borrower: { label: "Mallory", description: "Sanctions demo — blocked before scoring" },
};

const RIPPLE_EPOCH = 946684800; // 2000-01-01 in Unix seconds

export function localLedger(): ApiLedger {
  const wallets = loadWallets(); // reads apps/api/wallets.json; throws a clear message if missing
  const list: DemoWallet[] = (Object.keys(wallets) as Role[]).map((role) => ({
    role, ...PROFILES[role], address: wallets[role].address,
  }));
  return {
    getWallets: () => list,
    getVaultPhase: () => {
      const s = readState();
      if (!s.vaultId) return null;
      // shortcut: local clock instead of the ledger's close time; good to a few seconds.
      return vaultPhase(Math.floor(Date.now() / 1000) - RIPPLE_EPOCH, s.subscriptionDate, s.redemptionDate);
    },
  };
}
