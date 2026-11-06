import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Where the ledger keeps small named text: wallet seeds and vault IDs. Plain files by default;
// the Cloudflare Worker swaps in Durable Object storage, which has no filesystem to write to.
export interface BlobStore {
  read(name: string): string | null;
  write(name: string, text: string): void;
}

let store: BlobStore = {
  read: (name) => (existsSync(name) ? readFileSync(name, "utf8") : null),
  write: (name, text) => writeFileSync(name, text),
};

export const useBlobStore = (next: BlobStore) => { store = next; };
export const blobs = () => store;
