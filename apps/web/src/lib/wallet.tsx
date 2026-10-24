import { createContext, useContext, useState, type ReactNode } from "react";
import type { DemoWallet } from "@hack/shared";
import { pickWallet, userWallets } from "./wallets";

// The wallet the user acts as, shared by the header switcher and both user screens, and remembered across reloads.

const KEY = "xrpl-lending:wallet";

// Storage can throw (private windows, blocked site data); the choice then lasts until the page closes.
const load = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const save = (address: string) => { try { localStorage.setItem(KEY, address); } catch { /* keep it in memory only */ } };

type WalletState = { wallets: DemoWallet[]; wallet: DemoWallet | null; setWallet: (w: DemoWallet) => void };
const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ wallets, children }: { wallets: DemoWallet[]; children: ReactNode }) {
  const [saved, setSaved] = useState(load);
  const setWallet = (w: DemoWallet) => { save(w.address); setSaved(w.address); };
  return (
    <WalletContext.Provider value={{ wallets: userWallets(wallets), wallet: pickWallet(wallets, saved), setWallet }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const state = useContext(WalletContext);
  if (!state) throw new Error("useWallet must be used inside a WalletProvider");
  return state;
}
