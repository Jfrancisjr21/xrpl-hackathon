import { VaultCreateFlags, type Client, type Wallet } from "xrpl";
import { submit, findCreated, ledgerCloseTime, ledgerEntry } from "./client";
import type { DepositorPosition, VaultPhase } from "./types";

export async function createVault(
  c: Client, broker: Wallet, mptId: string, domainId: string,
  subscriptionSec: number, termSec: number,
) {
  if (termSec < 180) throw new Error("VAULT_TERM_SEC must be at least 180");
  const subscriptionDate = (await ledgerCloseTime(c)) + subscriptionSec;
  const redemptionDate = subscriptionDate + termSec;
  const r = await submit(c, broker, {
    TransactionType: "VaultCreate",
    Account: broker.address,
    Asset: { mpt_issuance_id: mptId },
    Flags: VaultCreateFlags.tfVaultPrivate,
    DomainID: domainId,
    VaultKind: 1,
    SubscriptionDate: subscriptionDate,
    RedemptionDate: redemptionDate,
  });
  return { vaultId: findCreated(r.meta, "Vault").LedgerIndex, subscriptionDate, redemptionDate };
}

export function vaultPhase(now: number, subscriptionDate?: number, redemptionDate?: number): VaultPhase {
  if (subscriptionDate && now < subscriptionDate) return "subscription";
  if (redemptionDate && now >= redemptionDate) return "redemption";
  return "investment";
}

export function vaultDeposit(c: Client, who: Wallet, vaultId: string, mptId: string, amount: string) {
  return submit(c, who, {
    TransactionType: "VaultDeposit", Account: who.address, VaultID: vaultId,
    Amount: { mpt_issuance_id: mptId, value: amount },
  });
}

export function vaultWithdraw(c: Client, who: Wallet, vaultId: string, mptId: string, amount: string) {
  return submit(c, who, {
    TransactionType: "VaultWithdraw", Account: who.address, VaultID: vaultId,
    Amount: { mpt_issuance_id: mptId, value: amount },
  });
}

// Vault entry: AssetsTotal, AssetsAvailable, LossUnrealized, ShareMPTID, SubscriptionDate, RedemptionDate.
export const vaultInfo = (c: Client, vaultId: string) => ledgerEntry(c, vaultId);

// A depositor's stake, from their share-token balance. Zero if they never deposited.
export async function getDepositorPosition(c: Client, vaultId: string, address: string): Promise<DepositorPosition> {
  const none = { address, deposited: "0", sharePct: 0 };
  const v = await vaultInfo(c, vaultId);
  if (!v.ShareMPTID) return none;
  let totalShares = 0;
  try {
    const r: any = await c.request({ command: "ledger_entry", mpt_issuance: v.ShareMPTID, ledger_index: "validated" } as any);
    totalShares = Number(r.result.node.OutstandingAmount ?? 0);
  } catch { return none; }
  if (totalShares === 0) return none;
  let shares = 0;
  try {
    const r: any = await c.request({
      command: "ledger_entry",
      mptoken: { mpt_issuance_id: v.ShareMPTID, account: address },
      ledger_index: "validated",
    } as any);
    shares = Number(r.result.node.MPTAmount ?? 0);
  } catch { /* no share entry: never deposited */ }
  return {
    address,
    deposited: String(Math.floor((Number(v.AssetsTotal ?? 0) * shares) / totalShares)),
    sharePct: (shares / totalShares) * 100,
  };
}