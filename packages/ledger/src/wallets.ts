import { Wallet, type Client } from "xrpl";
import { blobs } from "./store";
import { ROLES, type Role } from "./types";

export const walletFile = () => process.env.WALLET_FILE ?? "wallets.json";

export function loadWallets(): Record<Role, Wallet> {
  const file = walletFile();
  const text = blobs().read(file);
  if (!text) throw new Error(`${file} not found in ${process.cwd()}. Run: pnpm ledger:fund-wallets`);
  const seeds = JSON.parse(text) as Partial<Record<Role, string>>;
  const missing = ROLES.filter((r) => !seeds[r]);
  if (missing.length) throw new Error(`${file} is missing ${missing.join(", ")}. Run: pnpm ledger:fund-wallets`);
  return Object.fromEntries(ROLES.map((r) => [r, Wallet.fromSeed(seeds[r]!)])) as Record<Role, Wallet>;
}

// Creates a faucet-funded wallet for every role not yet in the file. Saved one by one, so a retry resumes.
export async function fundMissingWallets(c: Client) {
  const file = walletFile();
  const seeds: Record<string, string> = JSON.parse(blobs().read(file) ?? "{}");
  for (const role of ROLES) {
    if (seeds[role]) continue;
    const { wallet, balance } = await c.fundWallet();
    seeds[role] = wallet.seed!;
    blobs().write(file, JSON.stringify(seeds, null, 2) + "\n");
    console.log(role.padEnd(10), wallet.address, balance, "XRP");
  }
}

// False once a Devnet reset has wiped the account.
export async function accountExists(c: Client, address: string) {
  try {
    await c.request({ command: "account_info", account: address, ledger_index: "validated" });
    return true;
  } catch (e) {
    if ((e as Error).message.includes("Account not found")) return false;
    if ((e as { data?: { error?: string } }).data?.error === "actNotFound") return false;
    throw e;
  }
}
