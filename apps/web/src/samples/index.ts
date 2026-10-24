import {
  estimateLoan,
  type ApplicationView, type DemoWallet, type HealthResponse, type LoanView, type TxResult, type VaultView,
} from "@hack/shared";

// Sample data typed from the contract, served by lib/api.ts when VITE_MOCK=true.
// Delete this folder once the API routes are merged and the screens run against them.

const hex = (seed: string) => seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
const tx = (seed: string): TxResult => ({
  hash: hex(seed), result: "tesSUCCESS", explorerUrl: `https://devnet.xrpl.org/transactions/${hex(seed)}`,
});
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

// Made-up addresses in the XRPL format; the real ones come from apps/api/wallets.json.
const wallets = [
  { role: "issuer", label: "Issuer", address: "rd3uVZqSdQ71SEqWVcKBCzWZrkDMCMP8rn" },
  { role: "broker", label: "Broker", address: "rJbB4E98rQMAVjh2FFLhVhoer2Q26pLpWV" },
  { role: "depositor", label: "Depositor", address: "r8AqjCgQk98JKVvZQittEGu8XPJAakMcHB" },
  { role: "agent", label: "Agent", address: "rooQgNKnf5egfNBUZtiEAuPQTenqvPfsE6" },
  { role: "alice", label: "Alice", address: "r82eGxR3UNRT8m37GYSvJt8yJPNsicR1SS", description: "Long history and a verified credential" },
  { role: "carol", label: "Carol", address: "r3j7JDENy5vhfTNE68uqt8iLVTiTJtHMiX", description: "Mid-range history, verified" },
  { role: "bob", label: "Bob", address: "rzqCVxHfv9ym1rBS6hpgCuxBGFERTT8azD", description: "New account with a thin file" },
  { role: "borrower", label: "Mallory", address: "riEvqzfvziy7y9dcDimBV2MFeKn6quzNrw", description: "Address on the demo sanctions list" },
] satisfies DemoWallet[];

const address = (role: DemoWallet["role"]) => wallets.find((w) => w.role === role)!.address;

// The vault is lending: the deposit window closed 10 minutes ago and Alice's 500 is out.
const lent = "500";
const vault = {
  vaultId: hex("9f3c1d8e6b2a47c5"),
  assetLabel: "TSTUSD",
  assetsTotal: "10000",
  assetsAvailable: String(10000 - Number(lent)),
  lossUnrealized: "0",
  utilizationPct: (Number(lent) / 10000) * 100,
  phase: "investment",
  subscriptionDate: minutesFromNow(-10),
  redemptionDate: minutesFromNow(110),
  position: { address: address("depositor"), deposited: "2500", sharePct: 25 },
} satisfies VaultView;

const health = { ok: true, mockMode: true, network: "devnet", vaultPhase: vault.phase } satisfies HealthResponse;

const loanId = hex("4b8e2f71c9a03d56");
const alicePlan = estimateLoan({ principal: lent, interestRate: 7400, paymentTotal: 6, paymentIntervalSec: 60 });
const createdAt = minutesFromNow(-2);

const applicationApproved = {
  id: 1,
  borrowerAddress: address("alice"),
  amount: lent,
  paymentTotal: 6,
  status: "active",
  decision: {
    approved: true,
    sanctions: { blocked: false },
    facts: { ageDays: 420, txCountSample: 120, trustlineCount: 4, hasCredential: true },
    featureSource: "demo-profile",
    score: { age: 30, activity: 18, trustlines: 20, credential: 20, total: 88 },
    minScore: 50,
    interestRate: 7400,
    reasons: ["Score 88 is above the minimum of 50", "Holds a verified credential"],
    explanation: "Alice has a long account history and a verified credential, so the agent approved her at 7.4%.",
    explanationSource: "template",
  },
  decisionHash: hex("e3b0c44298fc1c14"),
  loanId,
  tx: tx("7a1c9e3f5b2d8064"),
  createdAt,
  updatedAt: createdAt,
} satisfies ApplicationView;

const applicationDenied = {
  id: 2,
  borrowerAddress: address("bob"),
  amount: "500",
  paymentTotal: 6,
  status: "denied",
  decision: {
    approved: false,
    sanctions: { blocked: false },
    facts: { ageDays: 9, txCountSample: 24, trustlineCount: 0, hasCredential: false },
    featureSource: "demo-profile",
    score: { age: 1, activity: 6, trustlines: 0, credential: 0, total: 7 },
    minScore: 50,
    interestRate: null,
    reasons: ["Score 7 is below the minimum of 50"],
    explanation: "Bob's account is new and has no credential yet, so his score is below the minimum of 50.",
    explanationSource: "template",
  },
  createdAt,
  updatedAt: createdAt,
} satisfies ApplicationView;

const loan = {
  loanId,
  applicationId: applicationApproved.id,
  borrower: address("alice"),
  principal: lent,
  interestRate: 7400,
  paymentsRemaining: 6,
  nextDueIso: minutesFromNow(1),
  totalOwed: alicePlan.totalRepaid,
  status: "active",
  installmentDue: alicePlan.periodicPayment,
  payoffAmount: lent,
  canImpair: false,
  canDefault: false,
} satisfies LoanView;

const applications: ApplicationView[] = [applicationApproved, applicationDenied];
const loans: LoanView[] = [loan];

export const samples = {
  health,
  wallets,
  vault,
  applicationApproved,
  applicationDenied,
  loan,
  applicationsFor: (borrower: string) => applications.filter((a) => a.borrowerAddress === borrower),
  loansFor: (borrower?: string) => loans.filter((l) => !borrower || l.borrower === borrower),
};
