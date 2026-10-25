import type {
  AgentView as ContractAgent,
  ApplicationView as ContractApplication,
  AuditEvent,
  BrokerView,
  LoanView as ContractLoan,
  RevenueView,
  VaultView,
} from "@hack/shared";
import type { AgentState, ApplicationView, AuditEntry, BrokerSnapshot, LoanView } from "./model";

const amount = (value: string | null) => Number(value ?? 0);
const rate = (value: number | null) => (value ?? 0) / 1_000;

export function applicationFromContract(application: ContractApplication): ApplicationView {
  const score = application.decision.score;

  return {
    id: String(application.id),
    borrower: application.borrowerAddress,
    persona: "Borrower",
    amount: amount(application.amount),
    score: score?.total ?? 0,
    rate: rate(application.decision.interestRate),
    payments: application.paymentTotal,
    recommendation: application.decision.approved ? "approve" : score ? "review" : "deny",
    sanctions: application.decision.sanctions.blocked ? "flagged" : "clear",
    status: application.status,
    createdAt: application.createdAt,
    explanation: application.decision.explanation,
    credit: application.decision.credit ?? null,
    featureSource: application.decision.featureSource ?? "Sanctions gate",
    sanctionsSources: application.decision.sanctions.source
      ? [application.decision.sanctions.matchedEntry ?? application.decision.sanctions.source]
      : ["No sanctions match"],
    scoreParts: score ? [
      { label: "Account history", points: score.age, note: "Account age" },
      { label: "Activity", points: score.activity, note: "Transaction activity" },
      { label: "Trust lines", points: score.trustlines, note: "XRPL trust lines" },
      { label: "Credential", points: score.credential, note: "Verified credential" },
    ] : [],
    decisionHash: application.decisionHash,
    loanId: application.loanId,
    txHash: application.tx?.hash,
    brokerNote: application.brokerNote,
    error: application.error,
  };
}

export function loanFromContract(loan: ContractLoan): LoanView {
  return {
    id: loan.loanId,
    applicationId: String(loan.applicationId),
    borrower: loan.borrower,
    persona: "Borrower",
    principal: amount(loan.principal),
    rate: rate(loan.interestRate),
    paymentsRemaining: loan.paymentsRemaining ?? 0,
    nextDue: loan.nextDueIso ?? "",
    totalOwed: loan.totalOwed === null ? null : amount(loan.totalOwed),
    gracePeriodSeconds: null,
    status: loan.status,
    canImpair: loan.canImpair,
    canDefault: loan.canDefault,
  };
}

export function snapshotFromContract(
  broker: BrokerView,
  revenue: RevenueView,
  vault: VaultView,
): BrokerSnapshot {
  return {
    vaultTotal: amount(vault.assetsTotal),
    availableLiquidity: amount(vault.assetsAvailable),
    debtTotal: amount(broker.debtTotal),
    coverAvailable: amount(broker.coverAvailable),
    coverRateMinimum: broker.coverRateMinimum,
    vaultPhase: vault.phase,
    interestCollected: amount(revenue.interestCollected),
    platformFee: amount(revenue.platformFees),
    serviceFees: amount(revenue.serviceFees ?? "0"),
    originationFees: amount(revenue.originationFees ?? "0"),
    projectedFee: null,
    feeRate: broker.managementFeeRate / 1_000,
    revenueSource: "measured",
  };
}

export function agentFromContract(agent: ContractAgent): AgentState {
  return {
    running: !agent.paused,
    delegationActive: agent.delegationEnabled,
    autoApprove: false,
    minimumScore: agent.policy.minScore,
    maxLiquidityPercent: 100,
    policyVersion: "live",
  };
}

export function auditFromContract(event: AuditEvent): AuditEntry {
  return {
    id: String(event.id),
    at: event.at,
    actor: event.actor === "agent" || event.actor === "broker" ? event.actor : "system",
    action: event.action.replaceAll("_", " "),
    subject: event.loanId ?? (event.applicationId ? String(event.applicationId) : "System"),
    reason: event.note ?? "Recorded by the lending API",
    txHash: event.tx?.hash,
  };
}

export function alertsFromLoans(loans: ContractLoan[]) {
  return loans
    .filter((loan) => loan.canImpair || loan.status === "impaired")
    .map((loan) => ({ loanId: loan.loanId, message: "Payment overdue" }));
}
