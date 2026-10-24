import "./env";
import { clearVault } from "../state";
import { XrplLedger } from "../xrpl-ledger";

clearVault();
const ledger = new XrplLedger();
await ledger.init();
console.log("ids", await ledger.bootstrap());
console.log("vault", await ledger.getVault());

await ledger.close();
