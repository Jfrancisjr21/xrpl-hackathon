import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, setBrokerKey } from "./api";
import { isAmount, secondsUntil } from "./format";

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const call = (fetch: ReturnType<typeof reply>, i: number) => fetch.mock.calls[i] as unknown as [string, RequestInit];

afterEach(() => { vi.unstubAllGlobals(); setBrokerKey(null); });

describe("api", () => {
  it("throws ApiError with the server message, status and opensAt", async () => {
    vi.stubGlobal("fetch", reply(409, { error: "Deposits are closed", opensAt: "2026-10-25T12:00:00.000Z" }));
    const err = await api.deposit("rAddr", "5").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: "Deposits are closed", status: 409, opensAt: "2026-10-25T12:00:00.000Z" });
  });

  it("says the API can't be reached when fetch fails outright", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = await api.vault().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, message: "Can't reach the lending API. Check that it is running, then retry." });
  });

  it("sends the broker key only once it is set", async () => {
    const fetch = reply(200, []);
    vi.stubGlobal("fetch", fetch);
    await api.applications();
    setBrokerKey("k");
    await api.applications("pending_review");
    expect((call(fetch, 0)[1].headers as Record<string, string>)["x-broker-key"]).toBeUndefined();
    expect((call(fetch, 1)[1].headers as Record<string, string>)["x-broker-key"]).toBe("k");
    expect(call(fetch, 1)[0]).toBe("/api/applications?status=pending_review");
  });

  it("posts the pay mode the contract expects", async () => {
    const fetch = reply(200, {});
    vi.stubGlobal("fetch", fetch);
    await api.pay("ABC", "payoff");
    expect(call(fetch, 0)[0]).toBe("/api/loans/ABC/pay");
    expect(JSON.parse(call(fetch, 0)[1].body as string)).toEqual({ mode: "payoff" });
  });
});

describe("format", () => {
  it("counts down and handles bad dates", () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    expect(secondsUntil("2026-10-24T12:01:30Z", now)).toBe(90);
    expect(secondsUntil("2026-10-24T11:59:00Z", now)).toBe(-60);
    expect(secondsUntil("not a date", now)).toBeNull();
    expect(secondsUntil(null, now)).toBeNull();
  });

  it("accepts only whole-number amounts, as the contract does", () => {
    expect(isAmount("500")).toBe(true);
    expect(isAmount("12.5")).toBe(false);
    expect(isAmount("0")).toBe(false);
  });
});
