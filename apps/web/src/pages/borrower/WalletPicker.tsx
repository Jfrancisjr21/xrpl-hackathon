import type { DemoWallet } from "@hack/shared";
import { shortAddress } from "../../lib/format";

// The four demo borrowers, in demo order. Mallory is the "borrower" role.
const PERSONAS: DemoWallet["role"][] = ["alice", "carol", "bob", "borrower"];

export function WalletPicker({ wallets, selected, onSelect }: {
  wallets: DemoWallet[];
  selected: DemoWallet | null;
  onSelect: (w: DemoWallet) => void;
}) {
  const personas = PERSONAS.flatMap((role) => wallets.filter((w) => w.role === role));
  return (
    <div className="picker" role="group" aria-label="Demo borrowers">
      {personas.map((w) => (
        <button key={w.address} type="button" className="persona" aria-pressed={selected?.address === w.address} onClick={() => onSelect(w)}>
          <b>{w.label}</b>
          {w.role === "borrower" && <span className="status status--negative">Sanctions demo</span>}
          {w.description && <span className="desc">{w.description}</span>}
          <code>{shortAddress(w.address)}</code>
        </button>
      ))}
    </div>
  );
}
