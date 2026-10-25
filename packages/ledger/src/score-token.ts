import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  NFTokenCreateOfferFlags, NFTokenMintFlags, convertHexToString, convertStringToHex, getNFTokenID,
  type Client, type Wallet,
} from "xrpl";
import { findCreated, submit } from "./client";

// Feature 5: the score passport. One NFT per wallet, minted by the issuer, never transferable.
// The NFT's URI is only ipfs://<CID>; the record itself is a small JSON file addressed by that CID.
export const SCORE_TAXON = 7001;

// The passport record (the file behind the CID). No bureau data, no personal data: the wallet is the only identifier.
export interface ScoreRecord {
  v: 1;
  wallet: string;
  issuer: string;
  lcs: number;          // Ledger Credit Score: 60% credit + 40% internal, 0-100
  onChainScore: number; // the four wallet signals from the ledger, 0-100
  level: "A" | "B" | "C";
  kyc: boolean;
  credit: boolean;
  lending: boolean;
  decisionHash: string; // SHA-256 of the decision, same as the Feature 1 LoanSet memo
  issuedAt: string;     // ISO
  expiresAt: string;    // ISO
}

// Fixed key order, so the same record always has the same bytes and the same CID.
export function recordBytes(r: ScoreRecord): Buffer {
  const { v, wallet, issuer, lcs, onChainScore, level, kyc, credit, lending, decisionHash, issuedAt, expiresAt } = r;
  return Buffer.from(JSON.stringify({ v, wallet, issuer, lcs, onChainScore, level, kyc, credit, lending, decisionHash, issuedAt, expiresAt }));
}

// CIDv1, raw codec, sha2-256, base32: what `ipfs add --cid-version=1 --raw-leaves` gives for a file this small.
// Recomputing it from the bytes proves the record was not changed, without trusting whoever served it.
export function cidOf(bytes: Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest();
  const raw = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]);
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0, value = 0, out = "b";
  for (const byte of raw) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

export const uriFor = (cid: string) => convertStringToHex(`ipfs://${cid}`);
export function cidFromUri(uriHex?: string): string | null {
  if (!uriHex) return null;
  const uri = convertHexToString(uriHex);
  return uri.startsWith("ipfs://") ? uri.slice(7) : null;
}

// Where record files live. The API serves them, and IPFS_GATEWAY is tried for any CID not held locally.
export interface RecordStore {
  put(cid: string, bytes: Buffer): Promise<void>;
  get(cid: string): Promise<Buffer | null>;
}

export function fileStore(dir = process.env.PASSPORT_DIR ?? "passports"): RecordStore {
  return {
    async put(cid, bytes) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${cid}.json`), bytes);
    },
    async get(cid) {
      const file = join(dir, `${cid}.json`);
      if (existsSync(file)) return readFileSync(file);
      const gateway = process.env.IPFS_GATEWAY; // e.g. https://ipfs.io/ipfs/
      if (!gateway) return null;
      try {
        const res = await fetch(gateway + cid, { signal: AbortSignal.timeout(5000) });
        return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
      } catch {
        return null; // a slow or unreachable gateway is the same as not found
      }
    },
  };
}

// Loads the record behind a CID and checks the bytes still hash to it. Anything else is not a passport.
export async function loadRecord(store: RecordStore, cid: string): Promise<ScoreRecord | null> {
  const bytes = await store.get(cid);
  if (!bytes || cidOf(bytes) !== cid) return null;
  try {
    const r = JSON.parse(bytes.toString("utf8"));
    return r?.v === 1 && typeof r.wallet === "string" && typeof r.lcs === "number" ? r : null;
  } catch {
    return null;
  }
}

export interface ScoreNft { nftId: string; owner: string; cid: string; record: ScoreRecord }

// Every NFT an account holds, all pages. An account that does not exist holds none.
async function nftsOf(c: Client, account: string): Promise<any[]> {
  const out: any[] = [];
  let marker: unknown;
  do {
    let r: any;
    try {
      r = await c.request({ command: "account_nfts", account, limit: 400, ledger_index: "validated", marker } as any);
    } catch (e: any) {
      if (e?.data?.error === "actNotFound") return [];
      throw e;
    }
    out.push(...r.result.account_nfts);
    marker = r.result.marker;
  } while (marker);
  return out;
}

// The newest valid passport for a wallet: on the wallet first, then still on the issuer.
// Valid = our issuer, our taxon, a record whose bytes match the CID, and a record about this wallet.
export async function findScoreToken(c: Client, store: RecordStore, issuer: string, address: string): Promise<ScoreNft | null> {
  for (const owner of address === issuer ? [issuer] : [address, issuer]) {
    const found: ScoreNft[] = [];
    for (const n of await nftsOf(c, owner)) {
      if (n.Issuer !== issuer || n.NFTokenTaxon !== SCORE_TAXON) continue;
      const cid = cidFromUri(n.URI);
      const record = cid ? await loadRecord(store, cid) : null;
      if (cid && record && record.wallet === address && record.issuer === issuer) found.push({ nftId: n.NFTokenID, owner, cid, record });
    }
    if (found.length) return found.sort((a, b) => b.record.issuedAt.localeCompare(a.record.issuedAt))[0];
  }
  return null;
}

// Stores the record, then mints. No tfTransferable: the holder can only hand it back. tfBurnable lets the issuer revoke it.
export async function mintScoreToken(c: Client, store: RecordStore, issuer: Wallet, record: ScoreRecord) {
  const bytes = recordBytes(record);
  const cid = cidOf(bytes);
  await store.put(cid, bytes);
  const r = await submit(c, issuer, {
    TransactionType: "NFTokenMint",
    Account: issuer.address,
    NFTokenTaxon: SCORE_TAXON,
    Flags: NFTokenMintFlags.tfBurnable,
    URI: uriFor(cid),
  });
  const nftId = getNFTokenID(r.meta);
  if (!nftId) throw new Error("NFTokenMint succeeded but the metadata has no NFTokenID");
  return { ...r, nftId, cid };
}

// Free sell offer that only the holder can accept, then the holder accepts it. Two writes.
export async function giveScoreToken(c: Client, issuer: Wallet, holder: Wallet, nftId: string) {
  const offer = await submit(c, issuer, {
    TransactionType: "NFTokenCreateOffer",
    Account: issuer.address,
    NFTokenID: nftId,
    Amount: "0",
    Destination: holder.address,
    Flags: NFTokenCreateOfferFlags.tfSellNFToken,
  });
  const offerId = findCreated(offer.meta, "NFTokenOffer").LedgerIndex;
  return submit(c, holder, { TransactionType: "NFTokenAcceptOffer", Account: holder.address, NFTokenSellOffer: offerId });
}

// The issuer can burn a token it minted with tfBurnable, even when someone else holds it.
export function burnScoreToken(c: Client, issuer: Wallet, nftId: string, owner?: string) {
  return submit(c, issuer, {
    TransactionType: "NFTokenBurn",
    Account: issuer.address,
    NFTokenID: nftId,
    ...(owner && owner !== issuer.address ? { Owner: owner } : {}),
  });
}
