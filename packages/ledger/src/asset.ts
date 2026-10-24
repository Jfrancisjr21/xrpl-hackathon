import { MPTokenIssuanceCreateFlags, encodeMPTokenMetadata, type Client, type Wallet } from "xrpl";
import { submit } from "./client";
import type { Role } from "./types";

// Starting TSTUSD per holder. Borrowers need some to pay interest and fees.
export const STARTING_FUNDS: Partial<Record<Role, string>> = {
  broker: "5000", borrower: "2500", alice: "2500", bob: "2500", carol: "2500",
};

// The depositor issues the MPT. Returns the MPT issuance ID.
export async function createAsset(c: Client, w: Record<Role, Wallet>): Promise<string> {
  const issuer = w.depositor;
  const r = await submit(c, issuer, {
    TransactionType: "MPTokenIssuanceCreate",
    Account: issuer.address,
    MaximumAmount: "100000000",
    TransferFee: 0,
    Flags:
      MPTokenIssuanceCreateFlags.tfMPTCanTransfer |
      MPTokenIssuanceCreateFlags.tfMPTCanClawback |
      MPTokenIssuanceCreateFlags.tfMPTCanTrade,
    MPTokenMetadata: encodeMPTokenMetadata({
      ticker: "TSTUSD",
      name: "Test USD MPT",
      desc: "A test stablecoin for the lending demo. No value.",
      icon: "https://example.org/tstusd-icon.png",
      asset_class: "rwa",
      asset_subclass: "stablecoin",
      issuer_name: "Demo Treasury",
    }),
  });
  const mptId = (r.meta as any).mpt_issuance_id as string;
  if (!mptId) throw new Error("No mpt_issuance_id in metadata");

  for (const [role, value] of Object.entries(STARTING_FUNDS) as [Role, string][]) {
    const who = w[role];
    await submit(c, who, { TransactionType: "MPTokenAuthorize", Account: who.address, MPTokenIssuanceID: mptId });
    await submit(c, issuer, {
      TransactionType: "Payment", Account: issuer.address,
      Destination: who.address, Amount: { mpt_issuance_id: mptId, value },
    });
  }
  return mptId;
}