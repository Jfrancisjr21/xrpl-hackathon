// pnpm --filter @hack/risk sanctions:build
// Reads data/raw/ and writes the committed src/sanctions-index.json and src/sanctions-meta.json.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { buildIndex } from "../src/sdn";

const RAW = new URL("../data/raw/", import.meta.url);
const SRC = new URL("../src/", import.meta.url);

// The files are Latin-1 and end with a \x1A end-of-file byte.
const read = (file: string): string[][] =>
  parse(readFileSync(new URL(file, RAW), "latin1").replace(/\x1a/g, ""), {
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
  });

const sdn = read("SDN.CSV");
const comments = read("SDN_COMMENTS.CSV");
const index = buildIndex(sdn, comments);
const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));

const meta = {
  source: "OFAC SDN list (SDN.CSV + SDN_COMMENTS.CSV), sanctionslistservice.ofac.treas.gov",
  fetchedAt: statSync(new URL("SDN.CSV", RAW)).mtime.toISOString(),
  entryCount: sdn.length,
  xrpAddressCount: Object.keys(sorted).length,
};

writeFileSync(new URL("sanctions-index.json", SRC), JSON.stringify(sorted, null, 2) + "\n");
writeFileSync(new URL("sanctions-meta.json", SRC), JSON.stringify(meta, null, 2) + "\n");
console.log(meta);
