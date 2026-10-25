// Turns the OFAC SDN CSV rows into an XRP-address index. Used by scripts/sanctions-build.ts, never at runtime.

// XRPL addresses are "r" + base58 (no 0, O, I or l), so the trailing "." of the sentence is never captured.
const XRP_ADDRESS = /Digital Currency Address - XRP (r[1-9A-HJ-NP-Za-km-z]{24,34})/g;

export type SanctionsIndex = Record<string, string>; // XRP address -> SDN entry name

export function extractXrpAddresses(remarks: string): string[] {
  return [...remarks.matchAll(XRP_ADDRESS)].map((m) => m[1]);
}

// sdnRows: [ent_num, name, ..., remarks (column 12)]. commentRows: [ent_num, remarks continued].
// Long remarks overflow into SDN_COMMENTS.CSV, so an entry's remarks are both pieces joined.
export function buildIndex(sdnRows: string[][], commentRows: string[][]): SanctionsIndex {
  const overflow = new Map<string, string>();
  for (const [id, text] of commentRows) overflow.set(id, (overflow.get(id) ?? "") + text);

  const index: SanctionsIndex = {};
  for (const row of sdnRows) {
    const [id, name] = row;
    const remarks = (row[11] ?? "") + (overflow.get(id) ?? "");
    for (const address of extractXrpAddresses(remarks)) index[address] = name;
  }
  return index;
}
