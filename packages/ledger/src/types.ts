export type Role = "issuer" | "broker" | "depositor" | "borrower" | "agent" | "alice" | "bob" | "carol";
export const ROLES: Role[] = ["issuer", "broker", "depositor", "borrower", "agent", "alice", "bob", "carol"];

export interface DemoWallet { role: Role; label: string; address: string; description?: string }

export interface TxResult { hash: string; result: string; explorerUrl: string }

export type VaultPhase = "subscription" | "investment" | "redemption";

export interface VaultSnapshot {
  vaultId: string;
  assetLabel: string;
  assetsTotal: string;
  assetsAvailable: string;
  lossUnrealized: string;
  utilizationPct: number;          // (total - available) / total * 100
  phase: VaultPhase;
  subscriptionDate: string | null; // ISO: deposits close, loans open
  redemptionDate: string | null;   // ISO: withdrawals open
}

export interface BrokerSnapshot {
  loanBrokerId: string;
  debtTotal: string;
  debtMaximum?: string;
  coverAvailable: string;
  coverRateMinimum: number;        // 1/10th bp of debtTotal
  coverRateLiquidation: number;
  managementFeeRate: number;       // 1/10th bp of interest
}

export interface LoanTerms {
  borrower: string;                // address
  principal: string;
  interestRate: number;            // 1/10th bp, 5000 = 5 percent
  paymentTotal: number;
  paymentIntervalSec: number;
  gracePeriodSec: number;
  decisionMemo?: string;           // SHA-256 hex of the decision (Feature 1)
}

export type LoanStatus = "active" | "impaired" | "defaulted" | "paid";
export type PayMode = "installment" | "payoff";

export interface LoanSnapshot {
  loanId: string;
  borrower: string;
  principal: string;               // principal still outstanding
  interestRate: number;
  paymentsRemaining: number | null;
  nextDueIso: string | null;
  totalOwed: string | null;
  status: LoanStatus;
  installmentDue: string | null;   // amount for one payment, fees included
  payoffAmount: string | null;     // amount to close the loan now
  canImpair: boolean;              // a payment is late
  canDefault: boolean;             // late plus the grace period
}

export interface AccountFacts { ageDays: number; txCountSample: number; trustlineCount: number; hasCredential: boolean }
export interface FactsResult { facts: AccountFacts; featureSource: "ledger" | "demo-profile" }

export interface DepositorPosition { address: string; deposited: string; sharePct: number }

// Feature 5: what goes into a score passport, and what verify reads back.
export interface ScoreTokenFields {
  lcs: number;          // Ledger Credit Score, the final score
  onChainScore: number; // the four wallet signals
  level: "A" | "B" | "C";
  kyc: boolean;
  credit: boolean;
  lending: boolean;
  decisionHash: string;
}
export interface ScoreToken extends ScoreTokenFields {
  nftId: string;
  cid: string;          // the NFT's URI is ipfs://<cid>
  issuer: string;
  holder: string;       // the borrower once moved, else the issuer
  issuedAt: string;     // ISO
  expiresAt: string;    // ISO
  expired: boolean;
}

export interface LedgerService {
  init(): Promise<void>;
  close(): Promise<void>;
  bootstrap(): Promise<{ vaultId: string; loanBrokerId: string; assetId: string }>;
  getWallets(): DemoWallet[];
  getVault(): Promise<VaultSnapshot>;
  getPosition(address: string): Promise<DepositorPosition>;
  getBroker(): Promise<BrokerSnapshot>;
  deposit(address: string, amount: string): Promise<TxResult>;
  withdraw(address: string, amount: string): Promise<TxResult>;
  depositCover(amount: string): Promise<TxResult>;
  withdrawCover(amount: string): Promise<TxResult>;
  originateLoan(terms: LoanTerms): Promise<{ loanId: string; tx: TxResult }>;
  payLoan(loanId: string, mode: PayMode): Promise<{ tx: TxResult; amount: string }>;
  manageLoan(loanId: string, action: "impair" | "unimpair" | "default"): Promise<TxResult>;
  deleteLoan(loanId: string): Promise<TxResult>;
  getLoan(loanId: string): Promise<LoanSnapshot>;
  setAgentDelegation(enabled: boolean): Promise<TxResult | null>;
  getAccountFacts(address: string): Promise<FactsResult>;
  issueScoreToken(address: string, fields: ScoreTokenFields): Promise<{ nftId: string; cid: string; tx: TxResult; moveTx: TxResult | null }>;
  getScoreToken(address: string): Promise<ScoreToken | null>;
  getScoreRecord(cid: string): Promise<Buffer | null>;
  getDecisionMemo(txHash: string): Promise<string | null>; // Feature 1: the decision hash in a LoanSet's memo // the raw record file, for GET /api/passports/:cid
  revokeScoreToken(address: string): Promise<TxResult | null>;
}