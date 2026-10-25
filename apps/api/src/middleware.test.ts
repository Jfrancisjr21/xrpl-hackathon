import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { ApplicationIdParam, ApplicationQuery, LoanApplicationInput } from "@hack/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerNotReadyError } from "@hack/ledger";
import { OpenApplicationError } from "./db/db";
import { errorHandler, HttpError, onLedger, requireBrokerKey, validate } from "./middleware";

const KEY = "test-broker-key-123";
const ALICE = "rByhcLgLG7rzJ2ceqzJgM4bFjuQodSrYFb";

let server: Server;
let base = "";

beforeAll(async () => {
  process.env.BROKER_KEY = KEY;
  const app = express();
  app.use(express.json());
  app.post("/apply", validate({ body: LoanApplicationInput }), (req, res) => res.json(req.body));
  app.get("/apps", validate({ query: ApplicationQuery }), (req, res) => res.json(req.query));
  app.get("/apps/:id", validate({ params: ApplicationIdParam }), (req, res) => res.json({ id: req.params.id, type: typeof req.params.id }));
  app.post("/broker", requireBrokerKey, (_req, res) => res.json({ ok: true }));
  app.get("/missing", () => { throw new HttpError(404, "Application 7 not found"); });
  app.get("/open", () => { throw new OpenApplicationError("already open"); });
  app.get("/not-ready", () => onLedger(async () => { throw new LedgerNotReadyError("Loans open when the deposit window closes", "2026-10-24T15:35:00.000Z"); }));
  app.get("/refused", () => onLedger(async () => { throw new Error("LoanSet failed with tecINSUFFICIENT_FUNDS"); }));
  app.get("/bug", () => { throw new Error("oops"); });
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const call = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(base + path, { ...init, headers: { "content-type": "application/json", ...init.headers } });
  return { status: res.status, body: await res.json() };
};

describe("validate", () => {
  it("lets good data through, with unknown fields stripped", async () => {
    const r = await call("/apply", { method: "POST", body: JSON.stringify({ borrowerAddress: ALICE, amount: "500", paymentTotal: 3, isAdmin: true }) });
    expect(r).toEqual({ status: 200, body: { borrowerAddress: ALICE, amount: "500", paymentTotal: 3 } });
  });

  it("answers 400 with one message per bad field", async () => {
    const r = await call("/apply", { method: "POST", body: JSON.stringify({ borrowerAddress: "x", amount: "abc", paymentTotal: 99 }) });
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.fields).sort()).toEqual(["amount", "borrowerAddress", "paymentTotal"]);
  });

  it("checks query strings too", async () => {
    expect((await call("/apps?status=denied")).status).toBe(200);
    expect((await call("/apps?status=closed")).body.fields).toHaveProperty("status");
  });

  it("turns a URL id into a number", async () => {
    expect((await call("/apps/7")).body).toEqual({ id: 7, type: "number" });
    expect((await call("/apps/abc")).status).toBe(400);
  });

  it("rejects a body that is not JSON", async () => {
    const r = await call("/apply", { method: "POST", body: "{nope" });
    expect(r).toEqual({ status: 400, body: { error: "Request body is not valid JSON" } });
  });
});

describe("requireBrokerKey", () => {
  it("accepts x-broker-key or a Bearer token", async () => {
    expect((await call("/broker", { method: "POST", headers: { "x-broker-key": KEY } })).status).toBe(200);
    expect((await call("/broker", { method: "POST", headers: { authorization: `Bearer ${KEY}` } })).status).toBe(200);
  });

  it("answers 401 for a missing or wrong key", async () => {
    expect((await call("/broker", { method: "POST" })).status).toBe(401);
    expect((await call("/broker", { method: "POST", headers: { "x-broker-key": "nope" } })).status).toBe(401);
  });

  it("fails closed when the server still has the placeholder key", async () => {
    process.env.BROKER_KEY = "change-me";
    expect((await call("/broker", { method: "POST", headers: { "x-broker-key": "change-me" } })).status).toBe(503);
    process.env.BROKER_KEY = KEY;
  });
});

describe("errorHandler", () => {
  it("maps each kind of error to its status and the ErrorResponse shape", async () => {
    expect(await call("/missing")).toEqual({ status: 404, body: { error: "Application 7 not found" } });
    expect((await call("/open")).status).toBe(409);
    expect(await call("/not-ready")).toEqual({ status: 409, body: { error: "Loans open when the deposit window closes", opensAt: "2026-10-24T15:35:00.000Z" } });
    expect(await call("/refused")).toEqual({ status: 502, body: { error: "The ledger refused or did not respond: LoanSet failed with tecINSUFFICIENT_FUNDS" } });
  });

  it("hides internal details of unexpected errors", async () => {
    const original = console.error;
    console.error = () => {};
    expect(await call("/bug")).toEqual({ status: 500, body: { error: "Something went wrong on the server" } });
    console.error = original;
  });
});
