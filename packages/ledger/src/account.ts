import type { Client } from "xrpl";
import { CREDENTIAL_TYPE } from "./access";
import type { AccountFacts } from "./types";

const RIPPLE_EPOCH = 946684800;
const MS_PER_DAY = 86_400_000;
const rippleDate = (tx: any): number | undefined => tx?.tx?.date ?? tx?.tx_json?.date;

export async function getAccountFacts(c: Client, address: string, issuerAddress: string): Promise<AccountFacts> {
  let ageDays = 0, txCountSample = 0, trustlineCount = 0, hasCredential = false;
  try { // oldest transaction gives the account age
    const r: any = await c.request({ command: "account_tx", account: address, ledger_index_min: -1, ledger_index_max: -1, limit: 1, forward: true } as any);
    const d = rippleDate((r.result.transactions ?? [])[0]);
    if (d !== undefined) ageDays = Math.max(0, Math.floor((Date.now() - (d + RIPPLE_EPOCH) * 1000) / MS_PER_DAY));
  } catch { /* unfunded address */ }
  try {
    const r: any = await c.request({ command: "account_tx", account: address, ledger_index_min: -1, ledger_index_max: -1, limit: 200 } as any);
    txCountSample = (r.result.transactions ?? []).length;
  } catch {}
  try {
    const r: any = await c.request({ command: "account_lines", account: address, limit: 400 } as any);
    trustlineCount = (r.result.lines ?? []).length;
  } catch {}
  try {
    const r: any = await c.request({ command: "account_objects", account: address, type: "credential", ledger_index: "validated" } as any);
    hasCredential = (r.result.account_objects ?? []).some(
      (o: any) => o.Issuer === issuerAddress && o.CredentialType === CREDENTIAL_TYPE,
    );
  } catch {}
  return { ageDays, txCountSample, trustlineCount, hasCredential };
}