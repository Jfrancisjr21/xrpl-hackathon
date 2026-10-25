import type { AccountFacts, Role } from "./types";

export interface DemoProfile { label: string; description: string; facts?: AccountFacts }

// Wallet (on-chain) part of the score, packages/risk. The final score is 60% credit + 40% this,
// so with the demo bureau: Alice 87 (level A, 7.6%), Carol 57 (level C, 13.6%), Bob no credit file.
// Wallet formula:
//   ageDays    -> min(floor(d / 365 * 30), 30)
//   txCount    -> min(floor(n / 200 * 30), 30)
//   trustlines -> min(count * 5, 20)
//   credential -> 20 or 0
// alice -> 30 + 18 + 20 + 20 = 88
// carol -> 14 + 12 + 15 + 20 = 61
// bob   ->  1 +  1 +  5 +  0 =  7  and no credit file, so a secured credit-builder offer
// borrower (Mallory) -> blocked by the sanctions gate before scoring
export const DEMO_PROFILES: Partial<Record<Role, DemoProfile>> = {
  alice: {
    label: "Alice", description: "Strong profile — approved, low rate",
    facts: { ageDays: 365, txCountSample: 120, trustlineCount: 4, hasCredential: true },
  },
  carol: {
    label: "Carol", description: "Mid-range profile — approved, higher rate",
    facts: { ageDays: 180, txCountSample: 80, trustlineCount: 3, hasCredential: true },
  },
  bob: {
    label: "Bob", description: "No credit file — offered a secured credit-builder loan",
    facts: { ageDays: 20, txCountSample: 12, trustlineCount: 1, hasCredential: false },
  },
  borrower: {
    label: "Mallory", description: "Sanctions demo — blocked before scoring",
    facts: { ageDays: 30, txCountSample: 25, trustlineCount: 2, hasCredential: false },
  },
  depositor: { label: "Depositor", description: "Funds the vault" },
  broker: { label: "Broker", description: "Owns the vault and approves loans" },
  issuer: { label: "Issuer", description: "Issues KYC credentials" },
  agent: { label: "Agent", description: "Co-signer for two-key approval" },
};