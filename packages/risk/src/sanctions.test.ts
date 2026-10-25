import { describe, expect, it } from "vitest";
import { checkAddress, sanctionsMeta } from "./sanctions";
import { buildIndex, extractXrpAddresses } from "./sdn";
import ofacIndex from "./sanctions-index.json";

const OFAC_XRP = "rnXyVQzgxZe7TR1EPzTkGj2jxH4LMJYh66"; // CHATEX, from the real SDN list
const MALLORY = "rPXGUmAeAV7YMtxu8pv8PuHPrTzw49YVtP"; // a borrower-role faucet wallet
const ALICE = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb";
const demo = { [MALLORY]: "Sanctions demo (borrower role)" };

describe("checkAddress", () => {
  it("blocks the real OFAC XRP address", () => {
    expect(checkAddress(OFAC_XRP)).toEqual({ blocked: true, source: "ofac", matchedEntry: "CHATEX" });
  });

  it("blocks Mallory through the demo entry the API adds at startup (R17)", () => {
    expect(checkAddress(MALLORY, demo)).toEqual({ blocked: true, source: "demo", matchedEntry: "Sanctions demo (borrower role)" });
  });

  it("lets a clean address through", () => {
    expect(checkAddress(ALICE, demo)).toEqual({ blocked: false });
  });

  it("matches exactly: no case folding, no partial matches", () => {
    expect(checkAddress(OFAC_XRP.toLowerCase()).blocked).toBe(false);
    expect(checkAddress(OFAC_XRP.slice(0, -1)).blocked).toBe(false);
  });

  it("is not fooled by object built-ins", () => {
    expect(checkAddress("toString").blocked).toBe(false);
  });
});

describe("building the index", () => {
  it("drops the sentence's trailing period", () => {
    expect(extractXrpAddresses(`alt. Digital Currency Address - XRP ${OFAC_XRP}.`)).toEqual([OFAC_XRP]);
  });

  it("ignores other currencies", () => {
    expect(extractXrpAddresses("Digital Currency Address - XBT 3E7YbpXuhh3CWFks1jmvWoV8y5DvsfzE6n;")).toEqual([]);
  });

  it("finds addresses that only appear in the comments overflow file", () => {
    const sdn = [["33854", "CHATEX", "-0- ", "CYBER2", "", "", "", "", "", "", "", "Website chatex.com; Digital Currency Address - XBT 3E7Y"]];
    const comments = [["33854", `bpXuhh3CWFks1jmvWoV8y5DvsfzE6n; alt. Digital Currency Address - XRP ${OFAC_XRP}.`]];
    expect(buildIndex(sdn, comments)).toEqual({ [OFAC_XRP]: "CHATEX" });
  });

  it("keeps the committed index and meta in step", () => {
    expect(sanctionsMeta.xrpAddressCount).toBe(Object.keys(ofacIndex).length);
    expect(sanctionsMeta.entryCount).toBeGreaterThan(10000);
  });
});
