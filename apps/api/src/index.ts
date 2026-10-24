import "dotenv/config";
import { createApp } from "./app";
import { openDb } from "./db/db";
import { localLedger } from "./services/ledger";
import { placeholderUnderwrite } from "./services/underwriting";

let ledger;
try {
  ledger = localLedger();
} catch (e) {
  console.error(`Cannot start: ${(e as Error).message}`); // e.g. wallets.json missing
  process.exit(1);
}

const app = createApp({ db: openDb(), ledger, underwrite: placeholderUnderwrite });
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`api listening on :${port}`));
