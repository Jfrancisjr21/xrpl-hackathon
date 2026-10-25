import { z } from "zod";

export * from "./fees";

// ---------- Group 1a: atoms reused by every other schema ----------

// A decimal string like "273.97", for amounts we display. Never a float.
export const Amount = z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal string like \"273.97\"");
export type Amount = z.infer<typeof Amount>;

// A positive whole-number string like "500", for amounts users send. The vault asset is a Devnet test MPT shown as simulated XRP; MPT amounts are integers.
export const AmountInput = z.string().regex(/^[1-9]\d*$/, "must be a whole number like \"500\"");
export type AmountInput = z.infer<typeof AmountInput>;

// A classic XRPL address: "r" plus base58 (no 0, O, I or l).
export const Address = z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, "must be an XRPL address starting with r");
export type Address = z.infer<typeof Address>;

// An ISO 8601 date string. The API converts Ripple-epoch ledger dates before they reach the contract (R15).
export const IsoDate = z.iso.datetime();
export type IsoDate = z.infer<typeof IsoDate>;

// A rate in tenths of a basis point: 1000 = 1 percent, 7400 = 7.4 percent.
export const Rate = z.number().int().min(0);
export type Rate = z.infer<typeof Rate>;

// A ledger object ID (vault, loan broker, loan): 64 hex characters.
export const LedgerId = z.string().regex(/^[0-9A-Fa-f]{64}$/, "must be a 64-character ledger ID");
export type LedgerId = z.infer<typeof LedgerId>;

// ---------- Group 1b: fixed lists ----------

// The eight wallets in apps/api/wallets.json. Mallory is the "borrower" role, not a role of her own.
export const Role = z.enum(["issuer", "broker", "depositor", "borrower", "agent", "alice", "bob", "carol"]);
export type Role = z.infer<typeof Role>;
export const ROLES = Role.options;

// Vault timeline: deposits only, then loans, then withdrawals.
export const VaultPhase = z.enum(["subscription", "investment", "redemption"]);
export type VaultPhase = z.infer<typeof VaultPhase>;

// ---------- Group 1c: small shapes built from the atoms ----------

// One entry in the wallet picker (GET /api/wallets).
export const DemoWallet = z.object({
  role: Role,
  label: z.string(),
  address: Address,
  description: z.string().optional(),
});
export type DemoWallet = z.infer<typeof DemoWallet>;

// Returned by every ledger write, so the UI can show the hash and an explorer link.
export const TxResult = z.object({
  hash: z.string().regex(/^[0-9A-Fa-f]{64}$/),
  result: z.string(), // "tesSUCCESS"
  explorerUrl: z.url(),
});
export type TxResult = z.infer<typeof TxResult>;

// GET /api/health. vaultPhase is null until bootstrap has created the vault.
export const HealthResponse = z.object({
  ok: z.boolean(),
  mockMode: z.boolean(),
  network: z.string(),
  vaultPhase: VaultPhase.nullable(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// Body of every non-2xx response.
// opensAt: on a 409 during the deposit window, when loans open. fields: on a 400, one message per bad field.
export const ErrorResponse = z.object({
  error: z.string(),
  opensAt: IsoDate.nullable().optional(),
  fields: z.record(z.string(), z.string()).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

// ---------- Group 2: vault and depositor ----------

// One depositor's stake in the vault, from their share-token balance. Zero if they never deposited.
export const DepositorPosition = z.object({
  address: Address,
  deposited: Amount,
  sharePct: z.number().min(0).max(100),
});
export type DepositorPosition = z.infer<typeof DepositorPosition>;

// GET /api/vault. Mirrors the ledger's VaultSnapshot; position is added when the caller passes ?address=.
export const VaultView = z.object({
  vaultId: LedgerId,
  assetLabel: z.string(), // "XRP" (simulated on Devnet)
  assetsTotal: Amount,
  assetsAvailable: Amount, // not lent out
  lossUnrealized: Amount, // at risk on impaired loans
  utilizationPct: z.number().min(0).max(100),
  phase: VaultPhase,
  subscriptionDate: IsoDate.nullable(), // deposits close, loans open
  redemptionDate: IsoDate.nullable(), // withdrawals open
  position: DepositorPosition.optional(),
});
export type VaultView = z.infer<typeof VaultView>;

// POST /api/vault/deposit and /api/vault/withdraw. Response: TxResult.
export const MoveFunds = z.object({
  address: Address,
  amount: AmountInput,
});
export type MoveFunds = z.infer<typeof MoveFunds>;

// POST /api/broker/cover/deposit and /withdraw. The broker wallet is implied. Response: TxResult.
export const CoverMove = z.object({
  amount: AmountInput,
});
export type CoverMove = z.infer<typeof CoverMove>;

// ---------- Group 3: applications and decision ----------

// POST /api/applications. The payment interval is not here: the server sets it (60 s when DEMO_FAST_LOANS=true).
// creditConsent is the borrower's authorization for a credit pull (FCRA permissible purpose); missing means no.
export const LoanApplicationInput = z.object({
  borrowerAddress: Address,
  amount: AmountInput,
  paymentTotal: z.number().int().min(1).max(24),
  creditConsent: z.boolean().optional(),
});
export type LoanApplicationInput = z.infer<typeof LoanApplicationInput>;

// Result of the sanctions gate. source and matchedEntry are only set when blocked.
// "demo" is the startup entry for the borrower role's address (R17); "ofac" is the local SDN index.
export const SanctionsResult = z.object({
  blocked: z.boolean(),
  source: z.enum(["ofac", "demo"]).optional(),
  matchedEntry: z.string().optional(),
});
export type SanctionsResult = z.infer<typeof SanctionsResult>;

// Inputs to the score. Mirrors the ledger's AccountFacts.
export const AccountFacts = z.object({
  ageDays: z.number().int().min(0),
  txCountSample: z.number().int().min(0),
  trustlineCount: z.number().int().min(0),
  hasCredential: z.boolean(),
});
export type AccountFacts = z.infer<typeof AccountFacts>;

// Where the facts came from: real ledger history, or an injected persona profile.
export const FeatureSource = z.enum(["ledger", "demo-profile"]);
export type FeatureSource = z.infer<typeof FeatureSource>;

// Points per wallet signal (caps: age 30, activity 30, trustlines 20, credential 20), then the blend:
// wallet = the four signals; internal = wallet + 10 per loan paid off with us (max 100);
// credit = middle bureau score mapped to 0-100 (null with no credit file);
// total = 60% credit + 40% internal, or internal alone with no credit file.
export const ScoreBreakdown = z.object({
  age: z.number().int().min(0).max(30),
  activity: z.number().int().min(0).max(30),
  trustlines: z.number().int().min(0).max(20),
  credential: z.number().int().min(0).max(20),
  wallet: z.number().int().min(0).max(100).optional(),
  paidOffBonus: z.number().int().min(0).max(100).optional(),
  internal: z.number().int().min(0).max(100).optional(),
  credit: z.number().int().min(0).max(100).nullable().optional(),
  total: z.number().int().min(0).max(100),
});
export type ScoreBreakdown = z.infer<typeof ScoreBreakdown>;

// What we keep from a credit pull: scores and reasons only, never SSN, date of birth or the report itself.
export const CreditBureauName = z.enum(["experian", "equifax", "transunion"]);
export const CreditSummary = z.object({
  provider: z.enum(["demo", "isoftpull"]),
  pullType: z.enum(["soft", "hard"]),
  pulledAt: IsoDate,
  fileFound: z.boolean(),
  scores: z.array(z.object({ bureau: CreditBureauName, model: z.string(), score: z.number().int().min(300).max(850) })),
  middleScore: z.number().int().min(300).max(850).nullable(), // middle of the bureaus' FICO 8, like a mortgage lender
  reasonCodes: z.array(z.string()), // the bureau's adverse-action reasons
});
export type CreditSummary = z.infer<typeof CreditSummary>;

// approved: unsecured loan offered. secured_offer: credit-builder loan up to maxAmount, fully backed by collateral.
// denied: sanctions, ban list, no credit consent, or amount above the secured limit.
export const DecisionOutcome = z.enum(["approved", "secured_offer", "denied"]);
export type DecisionOutcome = z.infer<typeof DecisionOutcome>;

// A: score 75+, B: 60-74, C: 50-59, secured: below 50 or no credit file. Each level has its own amount and term limits.
export const ApprovalLevel = z.enum(["A", "B", "C", "secured"]);
export type ApprovalLevel = z.infer<typeof ApprovalLevel>;

// The agent's full reasoning. facts, featureSource and score are null when the sanctions gate blocks before scoring.
// interestRate is null unless approved or offered secured. The SHA-256 of this object is the Feature 1 decision memo.
export const Decision = z.object({
  approved: z.boolean(),
  outcome: DecisionOutcome.optional(),
  sanctions: SanctionsResult,
  banned: z.boolean().optional(), // on our ban list after a defaulted loan
  facts: AccountFacts.nullable(),
  featureSource: FeatureSource.nullable(),
  credit: CreditSummary.nullable().optional(),
  score: ScoreBreakdown.nullable(),
  minScore: z.number().int().min(0).max(100),
  interestRate: Rate.nullable(),
  approvalLevel: ApprovalLevel.nullable().optional(),
  maxAmount: Amount.nullable().optional(), // smallest of the level cap, 20% of vault liquidity and cover headroom
  maxPaymentTotal: z.number().int().min(1).max(24).nullable().optional(),
  collateralRequired: Amount.nullable().optional(), // secured_offer only: equals the loan amount
  reasons: z.array(z.string()),
  explanation: z.string(),
  explanationSource: z.enum(["template", "ai"]),
});
export type Decision = z.infer<typeof Decision>;

// (new) -> denied | pending_review; pending_review -> rejected | originating; originating -> active | failed.
export const ApplicationStatus = z.enum(["denied", "pending_review", "rejected", "originating", "active", "failed"]);
export type ApplicationStatus = z.infer<typeof ApplicationStatus>;

// One application as the API returns it (POST and GET /api/applications, approve, reject).
export const ApplicationView = z.object({
  id: z.number().int().positive(),
  borrowerAddress: Address,
  amount: Amount,
  paymentTotal: z.number().int().min(1).max(24),
  status: ApplicationStatus,
  decision: Decision,
  decisionHash: z.string().regex(/^[0-9a-f]{64}$/).optional(), // Feature 1: SHA-256 hex of decision
  loanId: LedgerId.optional(), // once originated
  tx: TxResult.optional(), // the LoanSet
  brokerNote: z.string().optional(), // set on reject
  error: z.string().optional(), // set when status is failed
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type ApplicationView = z.infer<typeof ApplicationView>;

// GET /api/applications?status=&borrower=
export const ApplicationQuery = z.object({
  status: ApplicationStatus.optional(),
  borrower: Address.optional(),
});
export type ApplicationQuery = z.infer<typeof ApplicationQuery>;

// POST /api/applications/:id/reject
export const BrokerNote = z.object({
  note: z.string().trim().min(1).max(500),
});
export type BrokerNote = z.infer<typeof BrokerNote>;

// ---------- Group 4: loans ----------

// What the API passes to ledger.originateLoan(). Mirrors the ledger's LoanTerms; intervals are seconds.
export const LoanTerms = z.object({
  borrower: Address,
  principal: AmountInput,
  interestRate: Rate,
  paymentTotal: z.number().int().min(1).max(24),
  paymentIntervalSec: z.number().int().positive(),
  gracePeriodSec: z.number().int().min(0),
  decisionMemo: z.string().regex(/^[0-9A-Fa-f]{64}$/).optional(), // Feature 1: SHA-256 hex of the decision
});
export type LoanTerms = z.infer<typeof LoanTerms>;

// Read from the ledger, never stored by us.
export const LoanStatus = z.enum(["active", "impaired", "defaulted", "paid"]);
export type LoanStatus = z.infer<typeof LoanStatus>;

// installment = the amount due now; payoff = close the loan.
export const PayMode = z.enum(["installment", "payoff"]);
export type PayMode = z.infer<typeof PayMode>;

// GET /api/loans. Mirrors the ledger's LoanSnapshot plus the application it came from.
// The nullable amounts and dates are null once the loan is no longer open.
export const LoanView = z.object({
  loanId: LedgerId,
  applicationId: z.number().int().positive(),
  borrower: Address,
  principal: Amount, // still outstanding
  interestRate: Rate,
  paymentsRemaining: z.number().int().min(0).nullable(),
  nextDueIso: IsoDate.nullable(),
  totalOwed: Amount.nullable(),
  status: LoanStatus,
  installmentDue: Amount.nullable(), // one payment, fees included (R3)
  payoffAmount: Amount.nullable(),
  canImpair: z.boolean(), // a payment is late
  canDefault: z.boolean(), // late plus the grace period
});
export type LoanView = z.infer<typeof LoanView>;

// GET /api/loans?borrower=
export const LoanQuery = z.object({
  borrower: Address.optional(),
});
export type LoanQuery = z.infer<typeof LoanQuery>;

// POST /api/loans/:id/pay. POST /api/loans/:id/pay-due takes no body and pays one installment (R3).
export const PayRequest = z.object({
  mode: PayMode,
});
export type PayRequest = z.infer<typeof PayRequest>;

// Response of pay and pay-due: the transaction and how much was paid.
export const PayResult = z.object({
  tx: TxResult,
  amount: Amount,
});
export type PayResult = z.infer<typeof PayResult>;

// Route params arrive as strings. /api/loans/:id uses the ledger loan ID; /api/applications/:id uses our number.
export const LoanIdParam = z.object({ id: LedgerId });
export const ApplicationIdParam = z.object({ id: z.coerce.number().int().positive() });

// ---------- Group 5: broker side ----------

// GET /api/broker. Mirrors the ledger's BrokerSnapshot plus two computed fields:
// coverRequired = debtTotal × coverRateMinimum / 100000; coverHealthy = coverAvailable >= coverRequired.
// Below the minimum the broker earns no fees and cannot issue loans.
export const BrokerView = z.object({
  loanBrokerId: LedgerId,
  debtTotal: Amount,
  debtMaximum: Amount.optional(),
  coverAvailable: Amount,
  coverRateMinimum: Rate,
  coverRateLiquidation: Rate,
  managementFeeRate: Rate, // platform's share of interest, 10000 = 10 percent
  coverRequired: Amount,
  coverHealthy: z.boolean(),
});
export type BrokerView = z.infer<typeof BrokerView>;

// GET /api/broker/revenue. Totals from our payments rows (R10). Revenue never influences approval.
export const RevenueView = z.object({
  interestCollected: Amount,
  platformFees: Amount, // interestCollected × managementFeeRate / 100000
  depositorShare: Amount, // interestCollected - platformFees
  paymentsCount: z.number().int().min(0),
  managementFeeRate: Rate,
  serviceFees: Amount.optional(), // flat fee on every payment, paid to the broker
  originationFees: Amount.optional(), // flat fee taken from each loan's principal, paid to the broker
});
export type RevenueView = z.infer<typeof RevenueView>;

// Who caused an audit event. "system" is the monitor, bootstrap and demo reset.
export const AuditActor = z.enum(["agent", "broker", "borrower", "depositor", "system"]);
export type AuditActor = z.infer<typeof AuditActor>;

export const AuditAction = z.enum([
  "application_decided", "application_approved", "application_rejected",
  "loan_originated", "loan_failed", "loan_paid", "loan_impaired", "loan_unimpaired", "loan_defaulted", "loan_deleted",
  "vault_deposit", "vault_withdraw", "cover_deposit", "cover_withdraw",
  "agent_paused", "agent_resumed", "policy_updated", "demo_reset",
]);
export type AuditAction = z.infer<typeof AuditAction>;

// GET /api/broker/audit, newest first. at is ISO (R15).
export const AuditEvent = z.object({
  id: z.number().int().positive(),
  at: IsoDate,
  actor: AuditActor,
  action: AuditAction,
  applicationId: z.number().int().positive().optional(),
  loanId: LedgerId.optional(),
  tx: TxResult.optional(),
  note: z.string().optional(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

// The agent's tunable policy. POST /api/agent/policy takes this as its body.
export const AgentPolicy = z.object({
  minScore: z.number().int().min(0).max(100),
});
export type AgentPolicy = z.infer<typeof AgentPolicy>;

// GET /api/agent. delegationEnabled is Feature 3 (two-key approval); false until it ships.
export const AgentView = z.object({
  paused: z.boolean(),
  policy: AgentPolicy,
  delegationEnabled: z.boolean(),
});
export type AgentView = z.infer<typeof AgentView>;

// POST /api/agent/delegation. Response: TxResult, or null while Feature 3 is not built.
export const AgentDelegation = z.object({
  enabled: z.boolean(),
});
export type AgentDelegation = z.infer<typeof AgentDelegation>;

// GET /api/alerts (Feature 2). The monitor raises one per overdue loan.
export const Alert = z.object({
  loanId: LedgerId,
  borrower: Address,
  kind: z.enum(["overdue"]),
  nextDueIso: IsoDate,
  detectedAt: IsoDate,
});
export type Alert = z.infer<typeof Alert>;
