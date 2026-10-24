import { useWallet } from "../lib/wallet";
import { shortAddress } from "../lib/format";

/** Header control: which wallet the depositor and borrower screens act as. */
export function WalletSwitcher() {
  const { wallets, wallet, setWallet } = useWallet();
  if (!wallets.length) return null;
  return (
    <label className="wallet-switcher">
      <span>Acting as</span>
      <select
        value={wallet?.address ?? ""}
        onChange={(e) => { const w = wallets.find((x) => x.address === e.target.value); if (w) setWallet(w); }}
      >
        {wallets.map((w) => (
          <option key={w.address} value={w.address}>
            {w.label}{w.role === "borrower" ? " (sanctions demo)" : ""} · {shortAddress(w.address)}
          </option>
        ))}
      </select>
    </label>
  );
}
