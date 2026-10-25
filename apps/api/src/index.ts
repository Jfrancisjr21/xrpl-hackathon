import "dotenv/config";
import { XrplLedger } from "@hack/ledger";
import { createApp } from "./app";
import { openDb } from "./db/db";
import { cachedWithFallback, demoBureau } from "./services/credit";
import { isoftpullBureau } from "./services/isoftpull";
import { createMonitor } from "./services/monitor";
import { riskUnderwrite } from "./services/underwriting";

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

const db = openDb();
const monitor = createMonitor({ db, ledger });
monitor.start(10_000); // checks every loan for overdue payments every 10 s
// CREDIT_BUREAU=isoftpull uses iSoftpull's demo-mode test applicants (cached 24 h, demo bureau as fallback); default is demo.
const wallets = ledger.getWallets();
const demo = demoBureau(wallets);
const { CREDIT_BUREAU, ISOFTPULL_API_KEY, ISOFTPULL_API_SECRET } = process.env;
const useIsoftpull = CREDIT_BUREAU === "isoftpull" && !!ISOFTPULL_API_KEY && !!ISOFTPULL_API_SECRET;
if (CREDIT_BUREAU === "isoftpull" && !useIsoftpull) console.warn("CREDIT_BUREAU=isoftpull but ISOFTPULL_API_KEY / ISOFTPULL_API_SECRET are missing; using the demo bureau");
const pullCredit = useIsoftpull
  ? cachedWithFallback(db, isoftpullBureau(wallets, { apiKey: ISOFTPULL_API_KEY!, apiSecret: ISOFTPULL_API_SECRET! }), demo)
  : demo;
console.log(`credit bureau: ${useIsoftpull ? "isoftpull (cached 24 h, demo fallback)" : "demo"}`);
const underwrite = riskUnderwrite(ledger, pullCredit);
const app = createApp({ db, ledger, underwrite, alerts: monitor.alerts });
const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`api listening on :${port}`));
