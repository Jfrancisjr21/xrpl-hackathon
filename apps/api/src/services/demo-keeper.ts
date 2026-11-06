import type { LedgerService } from "@hack/ledger";
import { listAudit, resetAll, type Db } from "../db/db";

// The next visitor to a public demo should find Alice free to apply, not stuck on someone else's open loan.
// Clears the database once nothing has happened for idleMs. Resetting leaves no audit row, so this runs once per idle spell.
export function resetIfIdle(db: Db, idleMs: number, now = Date.now()): boolean {
  const last = listAudit(db, 1)[0];
  if (!last || now - Date.parse(last.at) < idleMs) return false;
  resetAll(db);
  return true;
}

// True when the vault is gone (Devnet reset) or past its term. A dropped connection is not a reason to rebuild.
export async function vaultNeedsRebuild(ledger: Pick<LedgerService, "getVault">) {
  try {
    return (await ledger.getVault()).phase === "redemption";
  } catch (e) {
    return (e as Error).message.includes("entryNotFound");
  }
}
