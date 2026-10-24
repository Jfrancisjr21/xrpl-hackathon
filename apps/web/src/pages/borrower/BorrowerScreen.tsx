import type { DemoWallet } from "@hack/shared";
import { WalletPicker } from "./WalletPicker";

// Phase 1 frame: pick a borrower. Phase 3 adds the application form, decision card and timeline; Phase 4 the loan.
export function BorrowerScreen({ wallets, wallet, onSelect }: {
  wallets: DemoWallet[];
  wallet: DemoWallet | null;
  onSelect: (w: DemoWallet) => void;
}) {
  return (
    <div className="screen">
      <h1>Borrow TSTUSD</h1>
      <WalletPicker wallets={wallets} selected={wallet} onSelect={onSelect} />
      {!wallet && <p className="hint">Pick a borrower to start.</p>}
    </div>
  );
}
