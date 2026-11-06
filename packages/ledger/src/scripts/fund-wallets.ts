import "./env";
import { connect, disconnect } from "../client";
import { fundMissingWallets } from "../wallets";

await fundMissingWallets(await connect());
await disconnect();
