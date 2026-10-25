import type { DemoWallet, CreditSummary, Role } from "@hack/shared";
import { getCachedCredit, saveCredit, type Db } from "../db/db";

// Soft pull from a credit bureau. Only scores and reason codes come back: never SSN, date of birth or the report itself.
export type PullCredit = (address: string) => Promise<CreditSummary>;

// Simulated bureau, keyed by role so it works on every laptop. Scores mirror iSoftpull's fictitious test applicants:
// A ~750 (Alice), B ~600 (Carol), E no credit file (Bob). Every other address has no file.
// Used when CREDIT_BUREAU=demo, and as the fallback when iSoftpull fails.
const DEMO_REPORTS: Partial<Record<Role, { scores: [number, number, number]; reasonCodes: string[] }>> = {
  alice: { scores: [742, 775, 780], reasonCodes: ["Amount owed on accounts too high"] },
  carol: { scores: [590, 600, 612], reasonCodes: ["Too many accounts with balances", "Length of time accounts have been established"] },
};

export function demoBureau(wallets: DemoWallet[]): PullCredit {
  return async (address) => {
    const role = wallets.find((w) => w.address === address)?.role;
    const report = role ? DEMO_REPORTS[role] : undefined;
    const pulled = { provider: "demo" as const, pullType: "soft" as const, pulledAt: new Date().toISOString() };
    if (!report) return { ...pulled, fileFound: false, scores: [], middleScore: null, reasonCodes: [] }; // thin file
    const [experian, equifax, transunion] = report.scores;
    return {
      ...pulled,
      fileFound: true,
      scores: [
        { bureau: "experian", model: "FICO 8", score: experian },
        { bureau: "equifax", model: "FICO 8", score: equifax },
        { bureau: "transunion", model: "FICO 8", score: transunion },
      ],
      middleScore: [...report.scores].sort((a, b) => a - b)[1], // middle of three, like a mortgage lender
      reasonCodes: report.reasonCodes,
    };
  };
}

// Reuses a pull from the last 24 h (stored as a summary in SQLite) and falls back to another bureau when the
// primary fails. The fallback's provider shows in the decision, so a demo answer is never presented as a real pull.
export function cachedWithFallback(
  db: Db,
  primary: PullCredit,
  fallback: PullCredit,
  maxAgeMs = 24 * 60 * 60 * 1000,
): PullCredit {
  return async (address) => {
    const hit = getCachedCredit(db, address);
    if (hit && Date.now() - Date.parse(hit.pulled_at) < maxAgeMs) return JSON.parse(hit.summary_json) as CreditSummary;
    try {
      const summary = await primary(address);
      saveCredit(db, address, JSON.stringify(summary), summary.pulledAt);
      return summary;
    } catch (e) {
      console.error(`credit pull failed, using the fallback bureau: ${(e as Error).message}`);
      return fallback(address);
    }
  };
}
