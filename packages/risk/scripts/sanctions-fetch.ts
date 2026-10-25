// pnpm --filter @hack/risk sanctions:fetch
// Downloads the OFAC SDN list ahead of time into data/raw/ (git-ignored). The API never fetches at runtime.
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/";
const RAW = new URL("../data/raw/", import.meta.url);

mkdirSync(RAW, { recursive: true });
for (const file of ["SDN.CSV", "SDN_COMMENTS.CSV"]) {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(new URL(file, RAW), bytes);
  console.log(file.padEnd(17), bytes.length, "bytes");
}
console.log("Next: pnpm --filter @hack/risk sanctions:build");
