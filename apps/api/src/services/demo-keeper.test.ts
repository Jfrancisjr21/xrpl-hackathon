import { beforeEach, describe, expect, it } from "vitest";
import { audit, listAudit, setConfig, getConfig, type Db } from "../db/db";
import { openDb } from "../db/open";
import { resetIfIdle, vaultNeedsRebuild } from "./demo-keeper";

const HOUR = 3_600_000;
let db: Db;

beforeEach(() => { db = openDb(":memory:"); });

describe("resetIfIdle", () => {
  it("leaves an empty database alone", () => {
    expect(resetIfIdle(db, HOUR)).toBe(false);
  });

  it("keeps recent activity", () => {
    audit(db, { actor: "system", action: "demo_reset" });
    expect(resetIfIdle(db, HOUR)).toBe(false);
    expect(listAudit(db)).toHaveLength(1);
  });

  it("clears everything, including a paused agent, once idle, and only once", () => {
    audit(db, { actor: "broker", action: "agent_paused" });
    setConfig(db, "paused", "true");
    const later = Date.now() + 2 * HOUR;
    expect(resetIfIdle(db, HOUR, later)).toBe(true);
    expect(listAudit(db)).toHaveLength(0);
    expect(getConfig(db, "paused")).toBeUndefined();
    expect(resetIfIdle(db, HOUR, later)).toBe(false);
  });
});

describe("vaultNeedsRebuild", () => {
  const withVault = (getVault: () => Promise<unknown>) => vaultNeedsRebuild({ getVault } as never);

  it("is false while the vault is lending", async () => {
    expect(await withVault(async () => ({ phase: "investment" }))).toBe(false);
  });
  it("is true past the redemption date", async () => {
    expect(await withVault(async () => ({ phase: "redemption" }))).toBe(true);
  });
  it("is true when the ledger no longer has the vault", async () => {
    expect(await withVault(async () => { throw new Error("entryNotFound"); })).toBe(true);
  });
  it("ignores a dropped connection", async () => {
    expect(await withVault(async () => { throw new Error("websocket was closed"); })).toBe(false);
  });
});
