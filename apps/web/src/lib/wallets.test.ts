import { describe, expect, it } from "vitest";
import { samples } from "../samples";
import { pickWallet, userWallets } from "./wallets";

const wallets = samples.wallets;
const byRole = (role: string) => wallets.find((w) => w.role === role)!;

describe("wallet", () => {
  it("offers the five user wallets in demo order, never the broker", () => {
    expect(userWallets(wallets).map((w) => w.label)).toEqual(["Lender", "Alice", "Carol", "Bob", "Mallory"]);
  });

  it("restores the saved wallet", () => {
    expect(pickWallet(wallets, byRole("bob").address)).toBe(byRole("bob"));
  });

  it("falls back to the depositor when the saved address is gone or not a user wallet", () => {
    expect(pickWallet(wallets, "rStaleAddressFromBeforeTheReset")).toBe(byRole("depositor"));
    expect(pickWallet(wallets, byRole("broker").address)).toBe(byRole("depositor"));
    expect(pickWallet(wallets, null)).toBe(byRole("depositor"));
    expect(pickWallet([], null)).toBeNull();
  });
});

describe("samples.vaultFor", () => {
  it("answers like GET /api/vault?address=", () => {
    expect(samples.vaultFor().position).toBeUndefined();
    expect(samples.vaultFor(byRole("depositor").address).position).toEqual(samples.vault.position);
    expect(samples.vaultFor(byRole("alice").address).position).toEqual({ address: byRole("alice").address, deposited: "0", sharePct: 0 });
  });
});
