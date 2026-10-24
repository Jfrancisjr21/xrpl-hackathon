import { existsSync, readFileSync, writeFileSync } from 'node:fs';


export interface LedgerState {
    domainId?: string;
    mptId?: string;
    vaultId?: string;
    loanBrokerId?: string;
    subscriptionDate?: number;   // Ripple epoch seconds
    redemptionDate?: number;
}

const file = () => process.env.STATE_FILE ?? "state.json";

export function readState(): LedgerState {
  return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {};
}

export function saveState(patch: Partial<LedgerState>): LedgerState {
  const next = { ...readState(), ...patch };
  writeFileSync(file(), JSON.stringify(next, null, 2) + "\n");
  return next;
}

// Forget the vault and broker so the next bootstrap creates fresh ones. The domain and asset are kept.
export function clearVault(): LedgerState {
  const { domainId, mptId } = readState();
  writeFileSync(file(), JSON.stringify({ domainId, mptId }, null, 2) + "\n");
  return { domainId, mptId };
}