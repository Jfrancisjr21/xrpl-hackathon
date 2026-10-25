import { describe, expect, it } from "vitest";
import type { DemoWallet } from "@hack/shared";
import { sampleVerification } from "./VerifyPanel";

const liveWallets = [
  { role: "alice", label: "Alice", address: "rBqYZRLHPFYfgdMZT4VtYdudfazzyYFV22" },
  { role: "borrower", label: "Mallory", address: "ram7UfHdCnkf4e2gGpnCpZvi7Qe1eppXFF2" },
] satisfies DemoWallet[];

describe("sampleVerification", () => {
  it("keeps the live address while matching the sample passport by wallet role", () => {
    expect(sampleVerification(liveWallets[0].address, liveWallets)).toMatchObject({
      address: liveWallets[0].address,
      verified: true,
    });
  });

  it("returns not verified for the demo blocked borrower", () => {
    expect(sampleVerification(liveWallets[1].address, liveWallets)).toEqual({
      address: liveWallets[1].address,
      verified: false,
      reason: "no_token",
    });
  });
});
