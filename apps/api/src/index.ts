import "dotenv/config";
import { XrplLedger } from "@hack/ledger";
import { createApp } from "./app";
import { openDb } from "./db/db";
import { placeholderUnderwrite } from "./services/underwriting";

const ledger = new XrplLedger();
try {
  await ledger.init(); // connects to XRPL_URL and loads wallets.json
  console.log("bootstrapping the ledger (first run creates the vault and broker, about 2 minutes)...");
  const ids = await ledger.bootstrap(); // idempotent: later starts reuse state.json
  console.log("ledger ready", ids);
} catch (e) {
  console.error(`Cannot start: ${(e as Error).message}`); // e.g. wallets.json missing, Devnet unreachable or reset
  process.exit(1);
}

const app = createApp({ db: openDb(), ledger, underwrite: placeholderUnderwrite });
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`api listening on :${port}`));
