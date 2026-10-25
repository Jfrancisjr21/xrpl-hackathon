import type { SanctionsResult } from "@hack/shared";
import type { SanctionsIndex } from "./sdn";
import ofacIndex from "./sanctions-index.json";
import ofacMeta from "./sanctions-meta.json";

export type { SanctionsIndex } from "./sdn";
export const sanctionsMeta = ofacMeta;

// Exact-match sanctions gate. extraEntries holds demo entries the API adds at startup,
// such as the borrower role's address for Mallory (R17). No fuzzy matching, no network, no LLM.
export function checkAddress(
  address: string,
  extraEntries: SanctionsIndex = {},
  index: SanctionsIndex = ofacIndex,
): SanctionsResult {
  if (Object.hasOwn(index, address)) return { blocked: true, source: "ofac", matchedEntry: index[address] };
  if (Object.hasOwn(extraEntries, address)) return { blocked: true, source: "demo", matchedEntry: extraEntries[address] };
  return { blocked: false };
}
