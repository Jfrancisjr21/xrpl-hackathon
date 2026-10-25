export type ApplicationStatus = "denied" | "pending_review" | "rejected" | "originating" | "active" | "failed";
export type ApplicationFilter = "pending_review" | "all";
export type ApplicationDecision = "approve" | "reject";
export type LoanStatus = "active" | "impaired" | "paid" | "defaulted";
export type LoanAction = "impair" | "default" | "unimpair" | "delete";
export type CoverAction = "deposit" | "withdraw";
export type Recommendation = "approve" | "review" | "deny";
export type SanctionsStatus = "clear" | "flagged";
export type HealthStatus = "good" | "watch" | "risk";

export interface ApplicationView {
  id: string;
  borrower: string;
  persona: string;
  amount: number;
  score: number;
  rate: number;
  payments: number;
  recommendation: Recommendation;
  sanctions: SanctionsStatus;
  status: ApplicationStatus;
  createdAt: string;
  explanation: string;
  featureSource: string;
  sanctionsSources: string[];
  scoreParts: Array<{ label: string; points: number; note: string }>;
  decisionHash?: string;
  loanId?: string;
  txHash?: string;
  brokerNote?: string;
  error?: string;
}

export interface LoanView {
  id: string;
  applicationId: string;
  borrower: string;
  persona: string;
  principal: number;
  rate: number;
  paymentsRemaining: number;
  nextDue: string;
  totalOwed: number | null;
  gracePeriodSeconds: number | null;
  status: LoanStatus;
  txHash?: string;
  canImpair?: boolean;
  canDefault?: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: "broker" | "agent" | "system";
  action: string;
  subject: string;
  reason: string;
  txHash?: string;
}

export interface BrokerSnapshot {
  vaultTotal: number;
  availableLiquidity: number;
  debtTotal: number;
  coverAvailable: number;
  coverRateMinimum: number;
  vaultPhase: "subscription" | "investment" | "redemption";
  interestCollected: number;
  platformFee: number;
  projectedFee: number | null;
  feeRate: number;
  revenueSource: "measured" | "estimated";
}

export interface AgentState {
  running: boolean;
  delegationActive: boolean;
  autoApprove: boolean;
  minimumScore: number;
  maxLiquidityPercent: number;
  policyVersion: string;
}

export interface LoanPermissions {
  canImpair: boolean;
  canDefault: boolean;
  canUnimpair: boolean;
  canDelete: boolean;
  overdueSeconds: number;
}

export interface LoanActionReceipt {
  loanId: string;
  action: LoanAction;
  confirmedAt: string;
  txHash?: string;
}

export function agentPolicyError(minimumScore: number, maxLiquidityPercent: number) {
  if (!Number.isInteger(minimumScore) || minimumScore < 0 || minimumScore > 100) {
    return "Minimum score must be a whole number from 0 to 100.";
  }
  if (!Number.isFinite(maxLiquidityPercent) || maxLiquidityPercent <= 0 || maxLiquidityPercent > 100) {
    return "Maximum liquidity per loan must be greater than 0% and no more than 100%.";
  }
  return null;
}

export function nextPolicyVersion(version: string) {
  const match = /^v(\d+)\.(\d+)$/.exec(version);
  if (!match) return version;
  return `v${match[1]}.${Number(match[2]) + 1}`;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function auditToCsv(entries: AuditEntry[]) {
  const header = ["Time", "Actor", "Title", "Detail", "Object", "Transaction"];
  const rows = entries.map((entry) => [
    entry.at,
    entry.actor,
    entry.action,
    entry.reason,
    entry.subject,
    entry.txHash ? explorerUrl(entry.txHash) : "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function filterApplications(applications: ApplicationView[], filter: ApplicationFilter) {
  if (filter === "all") return applications;
  return applications.filter((application) => application.status === filter);
}

export function applicationDecisionError(
  application: Pick<ApplicationView, "sanctions" | "status">,
  decision: ApplicationDecision,
  note = "",
) {
  if (application.status !== "pending_review") return "This application has already been decided.";
  if (decision === "approve" && application.sanctions === "flagged") {
    return "This application cannot be approved because the sanctions gate did not clear.";
  }
  if (decision === "reject" && !note.trim()) return "Add a review note before rejecting this application.";
  return null;
}

export function requiredCover(snapshot: Pick<BrokerSnapshot, "debtTotal" | "coverRateMinimum">) {
  return (snapshot.debtTotal * snapshot.coverRateMinimum) / 100_000;
}

export function coverRatio(snapshot: Pick<BrokerSnapshot, "coverAvailable" | "debtTotal" | "coverRateMinimum">) {
  const required = requiredCover(snapshot);
  return required === 0 ? Number.POSITIVE_INFINITY : snapshot.coverAvailable / required;
}

export function coverHealth(ratio: number): HealthStatus {
  if (ratio >= 1.5) return "good";
  if (ratio >= 1) return "watch";
  return "risk";
}

export function vaultUtilization(snapshot: Pick<BrokerSnapshot, "vaultTotal" | "debtTotal">) {
  if (snapshot.vaultTotal <= 0) return 0;
  return (snapshot.debtTotal / snapshot.vaultTotal) * 100;
}

export function coverAfterAdjustment(
  snapshot: Pick<BrokerSnapshot, "coverAvailable">,
  action: CoverAction,
  amount: number,
) {
  return action === "deposit" ? snapshot.coverAvailable + amount : snapshot.coverAvailable - amount;
}

export function coverAdjustmentError(
  snapshot: Pick<BrokerSnapshot, "coverAvailable">,
  action: CoverAction,
  amount: number,
) {
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount greater than zero.";
  if (action === "withdraw" && amount > snapshot.coverAvailable) {
    return "The withdrawal cannot exceed available first-loss cover.";
  }
  return null;
}

export function coverAdjustmentWarning(
  snapshot: Pick<BrokerSnapshot, "coverAvailable" | "debtTotal" | "coverRateMinimum">,
  action: CoverAction,
  amount: number,
) {
  if (action !== "withdraw" || coverAdjustmentError(snapshot, action, amount)) return null;
  if (coverAfterAdjustment(snapshot, action, amount) < requiredCover(snapshot)) {
    return "This withdrawal would put first-loss cover below the required minimum and pause platform fees.";
  }
  return null;
}

export function loanPermissions(loan: LoanView, now = Date.now()): LoanPermissions {
  const dueAt = Date.parse(loan.nextDue);
  const overdueSeconds = Number.isNaN(dueAt) ? 0 : Math.max(0, Math.floor((now - dueAt) / 1_000));
  const isLate = overdueSeconds > 0;

  return {
    canImpair: loan.canImpair ?? (loan.status === "active" && isLate),
    canDefault: loan.canDefault ?? (
      (loan.status === "active" || loan.status === "impaired") &&
      loan.gracePeriodSeconds !== null && overdueSeconds >= loan.gracePeriodSeconds
    ),
    canUnimpair: loan.status === "impaired",
    canDelete: loan.status === "paid" || loan.status === "defaulted",
    overdueSeconds,
  };
}

export function loanActionError(loan: LoanView, action: LoanAction, now = Date.now()) {
  const permissions = loanPermissions(loan, now);

  if (action === "impair" && !permissions.canImpair) {
    return loan.status !== "active"
      ? "Only an active loan can be impaired."
      : "Impair is available only after a payment is late.";
  }
  if (action === "default" && !permissions.canDefault) {
    return loan.status !== "active" && loan.status !== "impaired"
      ? "A paid or defaulted loan cannot be defaulted again."
      : "Default is available after the due date and grace period.";
  }
  if (action === "unimpair" && !permissions.canUnimpair) return "Only an impaired loan can be unimpaired.";
  if (action === "delete" && !permissions.canDelete) return "Delete is available only for paid or defaulted loans.";
  return null;
}

export function formatOverdueDuration(overdueSeconds: number) {
  if (overdueSeconds <= 0) return "Not overdue";
  if (overdueSeconds < 60) return "Less than 1 minute late";

  const minutes = Math.floor(overdueSeconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} late`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} late`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} late`;
}

export function formatMoney(value: number) {
  // simulated XRP on Devnet: "10,000 XRP", "272.90 XRP" (whole numbers without decimals, otherwise exactly 2)
  const digits = Number.isInteger(value) ? 0 : 2;
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 2 }).format(value)} XRP`;
}

export function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatMultiple(value: number, digits = 2) {
  return `${formatNumber(value, digits)}×`;
}

export function formatSeconds(value: number) {
  return `${formatNumber(value)} second${value === 1 ? "" : "s"}`;
}

export function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function shortId(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function explorerUrl(hash: string) {
  return `https://devnet.xrpl.org/transactions/${encodeURIComponent(hash)}`;
}
