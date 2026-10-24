import { Wallet } from "xrpl";
import { existsSync, readFileSync } from "node:fs";
import { ROLES, type Role } from "./types";

export const walletFile = () => process.env.WALLET_FILE ?? "wallets.json";

export function loadWallets(): Record<Role, Wallet> {
  const file = walletFile();
  if (!existsSync(file)) {
    throw new Error(`${file} not found in ${process.cwd()}. Run: pnpm ledger:fund-wallets`);
  }
  const seeds = JSON.parse(readFileSync(file, "utf8")) as Partial<Record<Role, string>>;
  const missing = ROLES.filter((r) => !seeds[r]);
  if (missing.length) throw new Error(`${file} is missing ${missing.join(", ")}. Run: pnpm ledger:fund-wallets`);
  return Object.fromEntries(ROLES.map((r) => [r, Wallet.fromSeed(seeds[r]!)])) as Record<Role, Wallet>;
}