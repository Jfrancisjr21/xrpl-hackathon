import type { DemoWallet, CreditSummary, Role } from "@hack/shared";

// Soft pull from a credit bureau. Only scores and reason codes come back: never SSN, date of birth or the report itself.
export type PullCredit = (address: string) => Promise<CreditSummary>;

// Simulated bureau, keyed by role so it works on every laptop. Scores mirror iSoftpull's fictitious test applicants:
// A ~750 (Alice), B ~600 (Carol), E no credit file (Bob). Every other address has no file.
// shortcut: demo data only; swap for the iSoftpull adapter (CREDIT_BUREAU=isoftpull) after R16.
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
