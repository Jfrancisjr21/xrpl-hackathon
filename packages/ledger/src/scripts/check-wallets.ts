import "./env";
import { connect, disconnect } from "../client";
import { loadWallets } from "../wallets";

const c = await connect();
for (const [role, w] of Object.entries(loadWallets())) {
  const xrp = await c.getXrpBalance(w.address).catch(() => "NOT FOUND");
  console.log(role.padEnd(10), w.address, xrp);
}
await disconnect();