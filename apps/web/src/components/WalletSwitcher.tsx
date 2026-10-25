import { useWallet } from "../lib/wallet";
import { shortAddress } from "../lib/format";

/** Header control on the Borrower tab: which borrower the screen acts as. The Lender tab always uses the depositor. */
export function WalletSwitcher() {
  const { wallets: all, wallet, setWallet } = useWallet();
  const wallets = all.filter((w) => w.role !== "depositor");
  if (!wallets.length) return null;
  return (
    <label className="wallet-switcher">
      <span>Acting as</span>
      <select
        value={wallet && wallet.role !== "depositor" ? wallet.address : ""}
        onChange={(e) => { const w = wallets.find((x) => x.address === e.target.value); if (w) setWallet(w); }}
      >
        <option value="" disabled>Pick a borrower</option>
        {wallets.map((w) => (
          <option key={w.address} value={w.address}>
            {w.label}{w.role === "borrower" ? " (sanctions demo)" : ""} · {shortAddress(w.address)}
          </option>
        ))}
      </select>
    </label>
  );
}
