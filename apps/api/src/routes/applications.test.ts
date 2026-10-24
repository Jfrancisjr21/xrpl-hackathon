import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { ApplicationView, DemoWallet, ErrorResponse, HealthResponse, type Decision } from "@hack/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { openDb, setConfig, type Db } from "../db/db";
import type { ApiLedger } from "../services/ledger";
import type { Underwrite } from "../services/underwriting";

const KEY = "test-broker-key-123";
const ALICE = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb";
const BOB = "rGgZFNrAko9bofdegqwMq2TxLVyXJnUn95";
const STRANGER = "rnXyVQzgxZe7TR1EPzTkGj2jxH4LMJYh66";

const fakeLedger: ApiLedger = {
  getWallets: () => [
    { role: "alice", label: "Alice", address: ALICE, description: "Strong profile" },
    { role: "bob", label: "Bob", address: BOB },
  ],
  getVaultPhase: () => "subscription",
};
const decision = (approved: boolean): Decision => ({
  approved, sanctions: { blocked: false }, facts: null, featureSource: null, score: null, minScore: 50,
  interestRate: approved ? 7400 : null, reasons: [approved ? "ok" : "no"], explanation: "x", explanationSource: "template",
});
// Alice is approved, Bob is denied.
const fakeUnderwrite: Underwrite = async (input) => decision(input.borrowerAddress === ALICE);

let db: Db, server: Server, base: string, underwriteCalls: number;
beforeEach(() => {
  process.env.BROKER_KEY = KEY;
  process.env.XRPL_URL = "wss://s.devnet.rippletest.net:51233";
  db = openDb(":memory:");
  underwriteCalls = 0;
  const counted: Underwrite = (i) => { underwriteCalls++; return fakeUnderwrite(i); };
  server = createApp({ db, ledger: fakeLedger, underwrite: counted }).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => server.close());

const call = async (path: string, init: { method?: string; body?: unknown; key?: string } = {}) => {
  const res = await fetch(base + path, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(init.key ? { "x-broker-key": init.key } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: await res.json() };
};
const apply = (address = ALICE) => call("/api/applications", { method: "POST", body: { borrowerAddress: address, amount: "500", paymentTotal: 3 } });

describe("health and wallets", () => {
  it("reports health in the contract shape", async () => {
    const r = await call("/api/health");
    expect(HealthResponse.parse(r.body)).toEqual({ ok: true, mockMode: false, network: "devnet", vaultPhase: "subscription" });
  });

  it("lists the demo wallets with descriptions (R13)", async () => {
    const r = await call("/api/wallets");
    expect(r.body.map((w: unknown) => DemoWallet.parse(w).label)).toEqual(["Alice", "Bob"]);
  });
});

describe("POST /api/applications", () => {
  it("creates an approved application in pending_review with a decision hash", async () => {
    const r = await apply();
    expect(r.status).toBe(201);
    const view = ApplicationView.parse(r.body);
    expect(view).toMatchObject({ id: 1, status: "pending_review", amount: "500" });
    expect(view.decisionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores a denial as final", async () => {
    expect((await apply(BOB)).body.status).toBe("denied");
  });

  it("refuses a second open application with 409, without underwriting again (R11)", async () => {
    await apply();
    const r = await apply();
    expect(r.status).toBe(409);
    expect(ErrorResponse.parse(r.body).error).toMatch(/already has an application/);
    expect(underwriteCalls).toBe(1);
  });

  it("lets a denied borrower apply again", async () => {
    await apply(BOB);
    expect((await apply(BOB)).status).toBe(201);
  });

  it("only accepts demo wallets", async () => {
    const r = await apply(STRANGER);
    expect(r.status).toBe(400);
    expect(r.body.fields.borrowerAddress).toMatch(/demo wallets/);
  });

  it("answers 400 per field for bad input", async () => {
    const r = await call("/api/applications", { method: "POST", body: { borrowerAddress: ALICE, amount: "10.5", paymentTotal: 30 } });
    expect(Object.keys(r.body.fields).sort()).toEqual(["amount", "paymentTotal"]);
  });

  it("refuses new applications while the agent is paused", async () => {
    setConfig(db, "paused", "true");
    expect((await apply()).status).toBe(409);
  });
});

describe("GET /api/applications", () => {
  it("lists newest first and filters by status and borrower", async () => {
    await apply(BOB);
    await apply();
    expect((await call("/api/applications")).body.map((a: { id: number }) => a.id)).toEqual([2, 1]);
    expect((await call("/api/applications?status=denied")).body).toHaveLength(1);
    expect((await call(`/api/applications?borrower=${ALICE}`)).body).toHaveLength(1);
    expect((await call("/api/applications?status=closed")).status).toBe(400);
  });

  it("gets one by id, or 404", async () => {
    await apply();
    expect((await call("/api/applications/1")).body.id).toBe(1);
    expect((await call("/api/applications/99")).status).toBe(404);
  });
});

describe("POST /api/applications/:id/reject", () => {
  it("needs the broker key", async () => {
    await apply();
    expect((await call("/api/applications/1/reject", { method: "POST", body: { note: "no" } })).status).toBe(401);
  });

  it("rejects a pending application with the broker's note and logs it", async () => {
    await apply();
    const r = await call("/api/applications/1/reject", { method: "POST", key: KEY, body: { note: "Amount too high for now" } });
    expect(r.body).toMatchObject({ status: "rejected", brokerNote: "Amount too high for now" });
  });

  it("answers 409 for anything not pending_review, and 400 for a blank note", async () => {
    await apply(BOB); // denied
    expect((await call("/api/applications/1/reject", { method: "POST", key: KEY, body: { note: "no" } })).status).toBe(409);
    await apply();
    expect((await call("/api/applications/2/reject", { method: "POST", key: KEY, body: { note: "   " } })).status).toBe(400);
  });
});
