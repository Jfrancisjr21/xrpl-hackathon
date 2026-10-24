import type { VaultView } from "@hack/shared";
import { describe, expect, it } from "vitest";
import { samples } from "../../samples";
import { depositorLocks } from "./locks";

const now = Date.parse("2026-10-24T15:00:00Z");
const at = (phase: VaultView["phase"], subscriptionInSec: number): VaultView => ({
  ...samples.vaultFor(),
  phase,
  subscriptionDate: new Date(now + subscriptionInSec * 1000).toISOString(),
});

describe("depositorLocks", () => {
  it("opens deposits only while the window runs, and never withdrawals", () => {
    expect(depositorLocks(at("subscription", 60), now)).toEqual({ deposit: null, withdraw: "Withdrawals open at the redemption date." });
  });

  it("closes deposits the moment the countdown hits zero, before the API reports the new phase", () => {
    expect(depositorLocks(at("subscription", 0), now).deposit).toBe("The deposit window has just closed.");
  });

  it("explains each later phase", () => {
    expect(depositorLocks(at("investment", -60), now)).toEqual({
      deposit: "Deposits are closed in the investment phase.",
      withdraw: "Withdrawals open at the redemption date.",
    });
    expect(depositorLocks(at("redemption", -60), now)).toEqual({ deposit: "Deposits are closed in the redemption phase.", withdraw: null });
  });
});
