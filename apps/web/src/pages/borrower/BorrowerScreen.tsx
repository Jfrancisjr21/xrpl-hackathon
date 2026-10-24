import { useWallet } from "../../lib/wallet";
import { WalletPicker } from "./WalletPicker";

// Phase 1 frame: pick a borrower. Phase 3 adds the application form, decision card and timeline; Phase 4 the loan.
// The picker and the header switcher set the same active wallet.
export function BorrowerScreen() {
  const { wallets, wallet, setWallet } = useWallet();
  const borrowing = wallet && wallet.role !== "depositor";
  return (
    <div className="screen">
      <h1>Borrow simulated XRP</h1>
      <WalletPicker wallets={wallets} selected={borrowing ? wallet : null} onSelect={setWallet} />
      {!borrowing && <p className="hint">Pick a borrower to start.</p>}
    </div>
  );
}
