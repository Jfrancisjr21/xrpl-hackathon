import { blobs } from "./store";

export interface LedgerState {
    domainId?: string;
    mptId?: string;
    vaultId?: string;
    loanBrokerId?: string;
    subscriptionDate?: number;   // Ripple epoch seconds
    redemptionDate?: number;
}

const file = () => process.env.STATE_FILE ?? "state.json";
const write = (s: LedgerState) => blobs().write(file(), JSON.stringify(s, null, 2) + "\n");

export function readState(): LedgerState {
  const text = blobs().read(file());
  return text ? JSON.parse(text) : {};
}

export function saveState(patch: Partial<LedgerState>): LedgerState {
  const next = { ...readState(), ...patch };
  write(next);
  return next;
}

// Forget the vault and broker so the next bootstrap creates fresh ones. The domain and asset are kept.
export function clearVault(): LedgerState {
  const { domainId, mptId } = readState();
  write({ domainId, mptId });
  return { domainId, mptId };
}

// After a Devnet reset none of these IDs exist any more.
export function clearState() {
  write({});
}
