import type { TxResult } from "@hack/shared";
import { shortHash } from "../lib/format";

/** Every successful write ends here: the ledger result and a link to the transaction. */
export function TxReceipt({ tx, label = "Confirmed on Devnet" }: { tx: TxResult | null; label?: string }) {
  if (!tx) return null;
  return (
    <p className="receipt" role="status">
      {label}: <a className="mono" href={tx.explorerUrl} target="_blank" rel="noreferrer">{shortHash(tx.hash)}</a>
    </p>
  );
}
