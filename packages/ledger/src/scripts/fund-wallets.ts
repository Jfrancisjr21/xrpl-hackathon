import "./env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { connect, disconnect } from "../client";
import { walletFile } from "../wallets";
import { ROLES } from "../types";

const file = walletFile();
const seeds: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const c = await connect();
for (const role of ROLES) {
  if (seeds[role]) continue;
  const { wallet, balance } = await c.fundWallet();
  seeds[role] = wallet.seed!;
  writeFileSync(file, JSON.stringify(seeds, null, 2) + "\n");
  console.log(role.padEnd(10), wallet.address, balance, "XRP");
}
await disconnect();