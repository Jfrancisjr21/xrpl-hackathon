import "./env";
import { XrplLedger } from "../xrpl-ledger";


const ledger = new XrplLedger();
await ledger.init();
console.log("ids", await ledger.bootstrap());
console.log("vault", await ledger.getVault());
console.log("broker", await ledger.getBroker());

await ledger.close();
