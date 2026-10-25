import "./env";
import { connect, submit } from "../client";
import { cidOf, fileStore, loadRecord } from "../score-token";
import { loadWallets } from "../wallets";
import { XrplLedger } from "../xrpl-ledger";

// Feature 5 on Devnet: issue Alice a passport, verify it, check it cannot be transferred, then burn it.
// KEEP=1 leaves Alice's passport on the ledger as a demo backup. Stop the API first (same wallets).
console.warn = () => {};
const ledger = new XrplLedger();
await ledger.init();
const w = loadWallets();
const alice = w.alice.address, bob = w.bob.address;

const issued = await ledger.issueScoreToken(alice, {
  lcs: 87, onChainScore: 88, level: "A", kyc: true, credit: true, lending: true, decisionHash: "ab".repeat(32),
});
console.log("mint".padEnd(10), issued.tx.explorerUrl);
console.log("move".padEnd(10), issued.moveTx?.explorerUrl ?? "stayed on the issuer");
console.log("uri".padEnd(10), `ipfs://${issued.cid}`, `(${`ipfs://${issued.cid}`.length} bytes, max 256)`);

const token = await ledger.getScoreToken(alice);
console.log("alice", token);
console.log("bob  ", await ledger.getScoreToken(bob), "(expect null)");

// The record file must hash back to its CID, and a changed file must not.
const bytes = (await ledger.getScoreRecord(issued.cid))!;
console.log("cid check", cidOf(bytes) === issued.cid ? "ok" : "MISMATCH");
const tampered = { put: async () => {}, get: async () => Buffer.from(bytes.toString().replace('"lcs":87', '"lcs":99')) };
console.log("tampered record rejected", (await loadRecord(tampered, issued.cid)) === null);
console.log("store round trip", (await loadRecord(fileStore(), issued.cid))?.lcs === 87);

// Non-transferable: Alice must not be able to offer her passport to Bob.
if (token?.holder === alice) {
  try {
    await submit(await connect(), w.alice, {
      TransactionType: "NFTokenCreateOffer", Account: alice, NFTokenID: token.nftId, Amount: "0", Destination: bob, Flags: 1,
    });
    console.log("PROBLEM: Alice could offer her passport to Bob");
  } catch (e) {
    console.log("transfer refused, as expected:", (e as Error).message);
  }
}

if (!process.env.KEEP) {
  const burned = await ledger.revokeScoreToken(alice);
  console.log("burn".padEnd(10), burned?.explorerUrl);
  console.log("after burn", await ledger.getScoreToken(alice), "(expect null)");
}
await ledger.close();
