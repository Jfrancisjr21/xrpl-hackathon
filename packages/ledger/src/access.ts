import { convertStringToHex, type Client, type Wallet } from "xrpl";
import { submit, findCreated } from "./client";
import type { Role } from "./types";

export const CREDENTIAL_TYPE = convertStringToHex("KYC-Verified");

// Who gets a KYC credential. Bob has none, which matches his demo profile.
export const CREDENTIALED: Role[] = ["broker", "depositor", "borrower", "alice", "carol"];

// The issuer owns the permissioned domain and issues every credential. Returns the domain ID.
export async function setupAccess(c: Client, w: Record<Role, Wallet>): Promise<string> {
  const d = await submit(c, w.issuer, {
    TransactionType: "PermissionedDomainSet",
    Account: w.issuer.address,
    AcceptedCredentials: [{ Credential: { Issuer: w.issuer.address, CredentialType: CREDENTIAL_TYPE } }],
  });
  const domainId = findCreated(d.meta, "PermissionedDomain").LedgerIndex;
  for (const role of CREDENTIALED) {
    const who = w[role];
    await submit(c, w.issuer, {
      TransactionType: "CredentialCreate", Account: w.issuer.address,
      Subject: who.address, CredentialType: CREDENTIAL_TYPE,
    });
    await submit(c, who, {
      TransactionType: "CredentialAccept", Account: who.address,
      Issuer: w.issuer.address, CredentialType: CREDENTIAL_TYPE,
    });
  }
  return domainId;
}