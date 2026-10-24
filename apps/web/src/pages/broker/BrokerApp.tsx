import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { api, setBrokerKey as setApiBrokerKey } from "../../lib/api";
import {
  agentFromContract,
  alertFromContract,
  applicationFromContract,
  auditFromContract,
  loanFromContract,
  snapshotFromContract,
} from "./contractAdapters";
import { demoAgent, demoApplications, demoAudit, demoLoans, demoSnapshot } from "./demoData";
import {
  agentPolicyError,
  applicationDecisionError,
  auditToCsv,
  coverAdjustmentError,
  coverAdjustmentWarning,
  coverAfterAdjustment,
  coverHealth,
  coverRatio,
  explorerUrl,
  filterApplications,
  formatDate,
  formatMoney,
  formatMultiple,
  formatNumber,
  formatOverdueDuration,
  formatPercent,
  formatSeconds,
  loanActionError,
  loanPermissions,
  nextPolicyVersion,
  requiredCover,
  shortId,
  vaultUtilization,
} from "./model";
import type {
  AgentState,
  ApplicationDecision,
  ApplicationFilter,
  ApplicationView,
  AuditEntry,
  BrokerSnapshot,
  CoverAction,
  LoanAction,
  LoanActionReceipt,
  LoanStatus,
  LoanView,
} from "./model";

type BrokerTab = "overview" | "applications" | "loans" | "agent";
type AlertView = { loanId: string; message: string };
type AgentAction = "status" | "policy" | "delegation";

const sampleMode = import.meta.env.VITE_MOCK === "true";

const tabs: Array<{ id: BrokerTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "applications", label: "Applications" },
  { id: "loans", label: "Loans" },
  { id: "agent", label: "Agent and audit" },
];

function BrokerGate({ onUnlock, onPreview }: { onUnlock: (key: string) => void; onPreview: () => void }) {
  const [key, setKey] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = key.trim();
    if (value) onUnlock(value);
  }

  return (
    <main className="gate-shell">
      <section className="gate-panel" aria-labelledby="gate-title">
        <div className="product-lockup">
          <span className="product-mark" aria-hidden="true"><span /></span>
          <span>XRPL Lending</span>
        </div>
        <h1 id="gate-title">Broker access</h1>
        <p>Review lending decisions and manage live Devnet loans from one controlled workspace.</p>
        <form onSubmit={submit}>
          <label htmlFor="broker-key">Broker key</label>
          <input
            id="broker-key"
            type="password"
            autoComplete="current-password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="Enter the key shared by Juan"
          />
          <button className="button button--primary" type="submit" disabled={!key.trim()}>
            Open broker workspace
          </button>
        </form>
        <button className="text-button gate-preview" type="button" onClick={onPreview}>
          Preview with sample contract data
        </button>
        <p className="gate-note">The key stays in this browser session and is sent as <code>x-broker-key</code>.</p>
      </section>
    </main>
  );
}

function Panel({ title, action, className = "", children }: { title: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`panel ${className}`.trim()}>
      <header className="panel-header">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function BrokerSkeleton() {
  const labels = ["Vault total", "Available liquidity", "Utilization", "Total debt", "Active loans", "Impaired loans"];

  return (
    <div className="skeleton-screen" aria-busy="true" aria-label="Loading broker workspace">
      <section className="metric-strip" aria-label="Loading vault summary">
        {labels.map((label, index) => (
          <div className={index === 0 ? "metric metric--lead" : "metric"} key={label}>
            <span>{label}</span>
            <span className="skeleton-bar" />
          </div>
        ))}
      </section>
      <div className="skeleton-grid">
        {["Loading applications", "Loading first-loss cover"].map((label) => (
          <section className="panel skeleton-panel" aria-label={label} key={label}>
            <span className="skeleton-bar skeleton-bar--heading" />
            <span className="skeleton-row" />
            <span className="skeleton-row" />
            <span className="skeleton-row skeleton-row--short" />
          </section>
        ))}
      </div>
    </div>
  );
}

function MetricStrip({ snapshot, loans }: { snapshot: BrokerSnapshot; loans: LoanView[] }) {
  const metrics = [
    ["Vault total", formatMoney(snapshot.vaultTotal)],
    ["Available liquidity", formatMoney(snapshot.availableLiquidity)],
    ["Utilization", formatPercent(vaultUtilization(snapshot))],
    ["Total debt", formatMoney(snapshot.debtTotal)],
    ["Active loans", formatNumber(loans.filter((loan) => loan.status === "active").length)],
    ["Impaired loans", formatNumber(loans.filter((loan) => loan.status === "impaired").length)],
  ];

  return (
    <section className="metric-strip" aria-label="Vault and queue summary">
      {metrics.map(([label, value], index) => (
        <div className={index === 0 ? "metric metric--lead" : "metric"} key={label}>
          <span>{label}</span>
          <strong className="num">{value}</strong>
        </div>
      ))}
    </section>
  );
}

function ApplicationsTable({
  applications,
  onSelect,
  compact = false,
  selectedId,
  label = "Applications",
}: {
  applications: ApplicationView[];
  onSelect: (application: ApplicationView) => void;
  compact?: boolean;
  selectedId?: string | null;
  label?: string;
}) {
  const rows = compact ? applications.slice(0, 3) : applications;

  if (!rows.length) return <div className="empty-state">No applications match this view.</div>;

  return (
    <div className="table-wrap">
      <table aria-label={label}>
        <thead>
          <tr>
            <th>Application</th>
            <th className="num">Amount</th>
            <th className="num">Score</th>
            <th>Recommendation</th>
            <th>Sanctions</th>
            <th>Status</th>
            <th>Created</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((application) => (
            <tr
              className={selectedId === application.id ? "application-row--selected" : undefined}
              aria-selected={selectedId === application.id}
              key={application.id}
            >
              <td>
                <button className="identity-button" type="button" onClick={() => onSelect(application)}>
                  <span>{application.persona}</span>
                  <small>{application.id} · {shortId(application.borrower)}</small>
                </button>
              </td>
              <td className="num">{formatMoney(application.amount)}</td>
              <td className="num score-cell">{application.score ? formatNumber(application.score) : "—"}</td>
              <td><StatusBadge value={application.recommendation} /></td>
              <td><StatusBadge value={application.sanctions} /></td>
              <td><StatusBadge value={application.status} /></td>
              <td><time dateTime={application.createdAt}>{formatDate(application.createdAt)}</time></td>
              <td className="row-action"><button type="button" onClick={() => onSelect(application)}>{application.status === "pending_review" ? "Review" : "View"}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverPanel({
  snapshot,
  pendingAction,
  notice,
  onAdjust,
}: {
  snapshot: BrokerSnapshot;
  pendingAction: CoverAction | null;
  notice: string | null;
  onAdjust: (action: CoverAction, amount: number) => Promise<void>;
}) {
  const [action, setAction] = useState<CoverAction | null>(null);
  const [amount, setAmount] = useState("");
  const parsedAmount = Number(amount);
  const error = action ? coverAdjustmentError(snapshot, action, parsedAmount) : null;
  const warning = action ? coverAdjustmentWarning(snapshot, action, parsedAmount) : null;
  const adjustedCover = action && !error ? coverAfterAdjustment(snapshot, action, parsedAmount) : snapshot.coverAvailable;
  const required = requiredCover(snapshot);
  const ratio = coverRatio(snapshot);
  const health = coverHealth(ratio);
  const maximum = Math.max(snapshot.coverAvailable, required, 1) * 1.15;
  const requiredPosition = (required / maximum) * 100;
  const availablePosition = Math.min((snapshot.coverAvailable / maximum) * 100, 100);
  const healthLabel = health === "good" ? "Healthy" : health === "watch" ? "Watch" : "Below minimum";

  function openDialog(nextAction: CoverAction) {
    setAmount("");
    setAction(nextAction);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || error) return;
    await onAdjust(action, parsedAmount);
    setAction(null);
  }

  return (
    <Panel title="First-loss cover" action={<StatusBadge value={health} label={healthLabel} />} className="cover-panel">
      <div className="cover-value">
        <strong className="num">{formatMoney(snapshot.coverAvailable)}</strong>
        <span>{required === 0 ? "No cover currently required" : `${formatMultiple(ratio)} required cover`}</span>
      </div>
      <div className="cover-scale" aria-label={`${formatMoney(snapshot.coverAvailable)} cover available; ${formatMoney(required)} required`}>
        <span className="cover-fill" style={{ width: `${availablePosition}%` }} />
        <span className="cover-minimum" style={{ left: `${requiredPosition}%` }} />
      </div>
      <div className="cover-labels">
        <span>0 XRP</span>
        <span>Minimum {formatMoney(required)}</span>
      </div>
      <p>{required === 0 ? "No minimum cover is required while total debt is zero." : `Cover is ${formatMultiple(ratio)} the minimum required by current debt.`}</p>
      {notice ? <div className="cover-notice" role="status">{notice}</div> : null}
      <div className="button-row">
        <button className="button button--secondary" type="button" onClick={() => openDialog("deposit")}>Deposit cover</button>
        <button className="button button--secondary" type="button" onClick={() => openDialog("withdraw")} disabled={snapshot.coverAvailable === 0}>Withdraw</button>
      </div>
      {action ? (
        <div className="dialog-scrim" onMouseDown={(event) => event.target === event.currentTarget && !pendingAction && setAction(null)}>
          <form className="confirm-dialog cover-dialog" onSubmit={submit} role="alertdialog" aria-modal="true" aria-labelledby="cover-dialog-title" onKeyDown={(event) => event.key === "Escape" && !pendingAction && setAction(null)}>
            <h3 id="cover-dialog-title">{action === "deposit" ? "Deposit first-loss cover" : "Withdraw first-loss cover"}</h3>
            <p>{action === "deposit" ? "Add broker capital to protect lenders." : "Review the remaining cover before confirming this withdrawal."}</p>
            <label htmlFor="cover-amount">Amount (XRP)</label>
            <input id="cover-amount" type="number" min="0.01" step="0.01" inputMode="decimal" autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} disabled={pendingAction !== null} />
            <dl className="confirm-terms cover-preview">
              <div><dt>Cover after action</dt><dd className="num">{formatMoney(adjustedCover)}</dd></div>
              <div><dt>Required minimum</dt><dd className="num">{formatMoney(required)}</dd></div>
            </dl>
            {amount && error ? <div className="inline-error" role="alert">{error}</div> : null}
            {warning ? <div className="decision-warning">{warning}</div> : null}
            <div className="button-row confirm-actions">
              <button className={action === "withdraw" && warning ? "button button--danger" : "button button--primary"} type="submit" disabled={Boolean(error) || pendingAction !== null}>
                {pendingAction ? "Updating…" : action === "deposit" ? "Confirm deposit" : warning ? "Withdraw anyway" : "Confirm withdrawal"}
              </button>
              <button className="button button--secondary" type="button" onClick={() => setAction(null)} disabled={pendingAction !== null}>Cancel</button>
            </div>
          </form>
        </div>
      ) : null}
    </Panel>
  );
}

function RevenuePanel({ snapshot }: { snapshot: BrokerSnapshot }) {
  const required = requiredCover(snapshot);
  const feesPaused = snapshot.coverAvailable < required;

  return (
    <Panel title="Platform revenue" action={<StatusBadge value={snapshot.revenueSource} label={snapshot.revenueSource} />}>
      <dl className="revenue-list">
        <div><dt>Fee rate</dt><dd className="num">{formatPercent(snapshot.feeRate, 0)}</dd></div>
        <div><dt>Interest collected</dt><dd className="num">{formatMoney(snapshot.interestCollected)}</dd></div>
        <div><dt>Platform fee earned</dt><dd className="num">{formatMoney(snapshot.platformFee)}</dd></div>
        <div><dt>Lender share</dt><dd className="num">{formatMoney(snapshot.interestCollected - snapshot.platformFee)}</dd></div>
        <div><dt>Projected active-loan fee</dt><dd className="num">{snapshot.projectedFee === null ? "—" : formatMoney(snapshot.projectedFee)}</dd></div>
      </dl>
      {feesPaused ? <div className="revenue-warning">Fees are not charged while first-loss cover is below the required minimum.</div> : null}
      <p className="panel-note">Revenue is {snapshot.revenueSource} · vault phase: {snapshot.vaultPhase}</p>
    </Panel>
  );
}

function Overview({
  applications,
  loans,
  alerts,
  alertError,
  snapshot,
  pendingCoverAction,
  coverNotice,
  onApplication,
  onLoan,
  onNavigate,
  onAdjustCover,
  onRefreshAlerts,
}: {
  applications: ApplicationView[];
  loans: LoanView[];
  alerts: AlertView[];
  alertError: string | null;
  snapshot: BrokerSnapshot;
  pendingCoverAction: CoverAction | null;
  coverNotice: string | null;
  onApplication: (application: ApplicationView) => void;
  onLoan: (loan: LoanView) => void;
  onNavigate: (tab: BrokerTab) => void;
  onAdjustCover: (action: CoverAction, amount: number) => Promise<void>;
  onRefreshAlerts: () => void;
}) {
  const pending = applications.filter((application) => application.status === "pending_review");

  return (
    <>
      <MetricStrip snapshot={snapshot} loans={loans} />
      <div className="overview-grid">
        <Panel
          title="Applications requiring a decision"
          action={<button className="text-button" type="button" onClick={() => onNavigate("applications")}>View queue</button>}
          className="queue-panel"
        >
          {pending.length ? (
            <ApplicationsTable applications={pending} onSelect={onApplication} compact />
          ) : (
            <div className="empty-state">No applications are waiting for review.</div>
          )}
        </Panel>
        <CoverPanel snapshot={snapshot} pendingAction={pendingCoverAction} notice={coverNotice} onAdjust={onAdjustCover} />
      </div>
      <div className="overview-lower">
        <Panel title="Loan alerts" action={<button className="text-button" type="button" onClick={() => onNavigate("loans")}>Open loans</button>}>
          {alertError ? (
            <div className="alert-error" role="alert">
              <span>{alertError}</span>
              <button className="text-button" type="button" onClick={onRefreshAlerts}>Retry</button>
            </div>
          ) : alerts.length ? (
            <div className="alert-list">
              {alerts.map((alert) => {
              const loan = loans.find((item) => item.id === alert.loanId);
              return (
                <button key={alert.loanId} type="button" className="alert-row" onClick={() => loan && onLoan(loan)}>
                  <span className="signal-dot" aria-hidden="true" />
                  <span><strong>{alert.message}</strong><small>{loan?.persona ?? "Borrower"} · {alert.loanId} · action available</small></span>
                  <span>Review</span>
                </button>
              );
              })}
            </div>
          ) : <div className="empty-state">No loan alerts. All current payments are on schedule.</div>}
        </Panel>
        <RevenuePanel snapshot={snapshot} />
      </div>
    </>
  );
}

function ApplicationDetail({
  application,
  note,
  error,
  pendingDecision,
  coverRateMinimum,
  onNote,
  onApprove,
  onReject,
  onBack,
}: {
  application: ApplicationView;
  note: string;
  error: string | null;
  pendingDecision: ApplicationDecision | null;
  coverRateMinimum: number;
  onNote: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onBack: () => void;
}) {
  const pending = application.status === "pending_review";
  const [confirmingApproval, setConfirmingApproval] = useState(false);
  const coverImpact = requiredCover({ debtTotal: application.amount, coverRateMinimum });
  const submittedAt = formatDate(application.createdAt);

  return (
    <aside className="detail-pane" aria-busy={pendingDecision !== null} aria-label={`Review ${application.id}`}>
      <button className="mobile-back" type="button" onClick={onBack}>Back to applications</button>
      <div className="detail-heading">
        <div><span>{application.id}</span><h2>{application.persona}</h2></div>
        <StatusBadge value={application.status} />
      </div>
      <dl className="detail-metrics">
        <div><dt>Requested</dt><dd className="num">{formatMoney(application.amount)}</dd></div>
        <div><dt>Score</dt><dd className="num">{application.score ? formatNumber(application.score) : "—"}</dd></div>
        <div><dt>Rate</dt><dd className="num">{application.rate ? formatPercent(application.rate) : "—"}</dd></div>
      </dl>
      <p className="detail-meta">
        Submitted {submittedAt === "—" ? "—" : <time dateTime={application.createdAt}>{submittedAt}</time>}
        <span aria-hidden="true"> · </span>{application.payments ? formatNumber(application.payments) : "—"} payments
      </p>
      <section className="detail-section">
        <h3>Decision</h3>
        <div className="decision-line"><StatusBadge value={application.recommendation} /><StatusBadge value={application.sanctions} /></div>
        <p>{application.explanation}</p>
        <dl className="evidence-source">
          <div><dt>Feature source</dt><dd>{application.featureSource}</dd></div>
          <div><dt>Sanctions sources</dt><dd>{application.sanctionsSources.join(", ")}</dd></div>
        </dl>
      </section>
      <section className="detail-section">
        <h3>Score evidence</h3>
        {application.scoreParts.length ? (
          <div className="score-parts">
            {application.scoreParts.map((part) => (
              <div key={part.label}><span><strong>{part.label}</strong><small>{part.note}</small></span><b className="num">+{formatNumber(part.points)}</b></div>
            ))}
          </div>
        ) : <div className="empty-state">Scoring stopped at the sanctions gate.</div>}
      </section>
      <section className="detail-section receipt-section">
        <h3>Decision receipt</h3>
        {application.decisionMemoTx ? (
          <a href={explorerUrl(application.decisionMemoTx)} target="_blank" rel="noreferrer">Open LoanSet memo on XRPL Explorer</a>
        ) : <p>The explorer link appears after LoanSet is confirmed.</p>}
      </section>
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      {pendingDecision ? (
        <div className="action-progress" role="status" aria-live="polite">
          {pendingDecision === "approve" ? "Originating the loan on Devnet…" : "Rejecting application…"}
        </div>
      ) : null}
      {pending ? (
        <div className="decision-actions">
          <label htmlFor="review-note">Review note</label>
          <textarea id="review-note" value={note} onChange={(event) => onNote(event.target.value)} placeholder="Required when rejecting" disabled={pendingDecision !== null} />
          <div className="button-row">
            <button className="button button--primary" type="button" onClick={() => setConfirmingApproval(true)} disabled={pendingDecision !== null}>Approve and originate</button>
            <button className="button button--danger" type="button" onClick={onReject} disabled={!note.trim() || pendingDecision !== null}>{pendingDecision === "reject" ? "Rejecting…" : "Reject"}</button>
          </div>
        </div>
      ) : null}
      {confirmingApproval && !pendingDecision ? (
        <div className="dialog-scrim" onMouseDown={(event) => event.target === event.currentTarget && setConfirmingApproval(false)}>
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="approval-dialog-title" onKeyDown={(event) => event.key === "Escape" && setConfirmingApproval(false)}>
            <h3 id="approval-dialog-title">Approve {application.id}?</h3>
            <p>LoanSet will originate these terms on XRPL Devnet.</p>
            <dl className="confirm-terms">
              <div><dt>Principal</dt><dd className="num">{formatMoney(application.amount)}</dd></div>
              <div><dt>Rate</dt><dd className="num">{formatPercent(application.rate)}</dd></div>
              <div><dt>Payments</dt><dd className="num">{formatNumber(application.payments)}</dd></div>
              <div><dt>Required cover added</dt><dd className="num">{formatMoney(coverImpact)}</dd></div>
            </dl>
            {application.recommendation === "deny" ? <div className="decision-warning">The agent recommended denying this application. Approving would be a broker override.</div> : null}
            <div className="button-row confirm-actions">
              <button className="button button--primary" type="button" autoFocus onClick={() => { setConfirmingApproval(false); onApprove(); }}>Confirm approval</button>
              <button className="button button--secondary" type="button" onClick={() => setConfirmingApproval(false)}>Cancel</button>
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}

function ApplicationsView({
  applications,
  selected,
  note,
  error,
  pendingDecision,
  onSelect,
  onNote,
  onApprove,
  onReject,
  onClose,
}: {
  applications: ApplicationView[];
  selected: ApplicationView | null;
  note: string;
  error: string | null;
  pendingDecision: ApplicationDecision | null;
  onSelect: (application: ApplicationView) => void;
  onNote: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<ApplicationFilter>("pending_review");
  const visibleApplications = filterApplications(applications, filter);
  const pendingCount = filterApplications(applications, "pending_review").length;

  return (
    <div className={`split-view ${selected ? "split-view--detail" : ""}`}>
      <Panel title="Application queue" action={<span className="queue-count">{formatNumber(visibleApplications.length)} shown</span>} className="list-pane">
        <div className="filter-row">
          <button className={`filter-button ${filter === "pending_review" ? "filter-button--active" : ""}`} type="button" aria-pressed={filter === "pending_review"} onClick={() => setFilter("pending_review")}>Pending review ({formatNumber(pendingCount)})</button>
          <button className={`filter-button ${filter === "all" ? "filter-button--active" : ""}`} type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All applications ({formatNumber(applications.length)})</button>
        </div>
        <ApplicationsTable applications={visibleApplications} onSelect={onSelect} selectedId={selected?.id} label="Application queue" />
      </Panel>
      {selected ? (
        <ApplicationDetail
          key={selected.id}
          application={selected}
          note={note}
          error={error}
          pendingDecision={pendingDecision}
          coverRateMinimum={demoSnapshot.coverRateMinimum}
          onNote={onNote}
          onApprove={onApprove}
          onReject={onReject}
          onBack={onClose}
        />
      ) : (
        <aside className="detail-pane detail-pane--empty"><p>Select an application to review its evidence and terms.</p></aside>
      )}
    </div>
  );
}

const loanActionCopy: Record<LoanAction, { label: string; description: string; danger?: boolean }> = {
  impair: {
    label: "Impair loan",
    description: "Mark this late loan as impaired while keeping repayment open.",
  },
  default: {
    label: "Default loan",
    description: "Mark this loan as defaulted. It cannot return to active or impaired status.",
    danger: true,
  },
  unimpair: {
    label: "Remove impairment",
    description: "Return this loan to active status. This action is not yet verified on the live ledger.",
  },
  delete: {
    label: "Delete closed loan",
    description: "Remove this paid or defaulted loan from the broker loan book.",
    danger: true,
  },
};

function LoansTable({ loans, selectedId, onSelect }: { loans: LoanView[]; selectedId?: string | null; onSelect: (loan: LoanView) => void }) {
  if (!loans.length) return <div className="empty-state">No loans are in the broker loan book.</div>;

  return (
    <div className="table-wrap">
      <table aria-label="Broker loan book">
        <thead><tr><th>Borrower</th><th className="num">Principal</th><th className="num">Rate</th><th className="num">Payments left</th><th>Next due</th><th className="num">Total owed</th><th>Status</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {loans.map((loan) => {
            const permissions = loanPermissions(loan);
            return (
              <tr className={selectedId === loan.id ? "application-row--selected" : undefined} aria-selected={selectedId === loan.id} key={loan.id}>
                <td><button className="identity-button" type="button" onClick={() => onSelect(loan)}><span>{loan.persona}</span><small>{loan.id} · {shortId(loan.borrower)}</small></button></td>
                <td className="num">{formatMoney(loan.principal)}</td>
                <td className="num">{formatPercent(loan.rate)}</td>
                <td className="num">{formatNumber(loan.paymentsRemaining)}</td>
                <td className={permissions.overdueSeconds ? "due-overdue" : ""}><time dateTime={loan.nextDue}>{formatDate(loan.nextDue)}</time>{permissions.overdueSeconds ? <small>{formatOverdueDuration(permissions.overdueSeconds)}</small> : null}</td>
                <td className="num">{formatMoney(loan.totalOwed)}</td>
                <td><StatusBadge value={loan.status} /></td>
                <td className="row-action"><button type="button" onClick={() => onSelect(loan)}>Details</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LoanDetail({ loan, error, pendingAction, onAction, onBack }: { loan: LoanView; error: string | null; pendingAction: LoanAction | null; onAction: (action: LoanAction) => void; onBack: () => void }) {
  const permissions = loanPermissions(loan);
  const [confirmingAction, setConfirmingAction] = useState<LoanAction | null>(null);
  const confirmation = confirmingAction ? loanActionCopy[confirmingAction] : null;

  return (
    <aside className="detail-pane" aria-busy={pendingAction !== null} aria-label={`Loan ${loan.id}`}>
      <button className="mobile-back" type="button" onClick={onBack}>Back to loans</button>
      <div className="detail-heading"><div><span>{loan.id}</span><h2>{loan.persona}</h2></div><StatusBadge value={loan.status} /></div>
      <dl className="detail-metrics"><div><dt>Principal</dt><dd className="num">{formatMoney(loan.principal)}</dd></div><div><dt>Owed</dt><dd className="num">{formatMoney(loan.totalOwed)}</dd></div><div><dt>Rate</dt><dd className="num">{formatPercent(loan.rate)}</dd></div></dl>
      <section className="detail-section">
        <h3>Payment state</h3>
        {permissions.overdueSeconds ? <p className="overdue-copy">Payment is {formatOverdueDuration(permissions.overdueSeconds).toLowerCase()}. The {formatSeconds(loan.gracePeriodSeconds)} grace period has {permissions.canDefault ? "passed" : "not passed"}.</p> : <p>Next payment is due {formatDate(loan.nextDue)}.</p>}
      </section>
      <section className="detail-section">
        <h3>Ledger actions</h3>
        <div className="action-stack">
          <button className="button button--secondary" type="button" disabled={!permissions.canImpair || pendingAction !== null} title={permissions.canImpair ? "Mark the late loan as impaired" : "Available only after a payment is late"} onClick={() => setConfirmingAction("impair")}>Impair loan</button>
          <button className="button button--danger" type="button" disabled={!permissions.canDefault || pendingAction !== null} title={permissions.canDefault ? "Default after the grace period" : "Available after due date and grace period"} onClick={() => setConfirmingAction("default")}>Default loan</button>
          <button className="button button--secondary" type="button" disabled={!permissions.canUnimpair || pendingAction !== null} title={permissions.canUnimpair ? "Return this loan to active status" : "Available only for impaired loans"} onClick={() => setConfirmingAction("unimpair")}>Remove impairment</button>
          <button className="text-button" type="button" disabled={!permissions.canDelete || pendingAction !== null} title={permissions.canDelete ? "Delete this closed loan" : "Available only for paid or defaulted loans"} onClick={() => setConfirmingAction("delete")}>Delete closed loan</button>
        </div>
      </section>
      {error ? <div className="inline-error" role="alert">{error}</div> : null}
      {pendingAction ? <div className="action-progress" role="status" aria-live="polite">Submitting {loanActionCopy[pendingAction].label.toLowerCase()}…</div> : null}
      <section className="detail-section receipt-section"><h3>Origination transaction</h3>{loan.txHash ? <a href={explorerUrl(loan.txHash)} target="_blank" rel="noreferrer">Open on XRPL Explorer</a> : <p>Transaction hash unavailable in sample contract data.</p>}</section>
      {confirmingAction && confirmation && !pendingAction ? (
        <div className="dialog-scrim" onMouseDown={(event) => event.target === event.currentTarget && setConfirmingAction(null)}>
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="loan-action-dialog-title" onKeyDown={(event) => event.key === "Escape" && setConfirmingAction(null)}>
            <h3 id="loan-action-dialog-title">{confirmation.label}?</h3>
            <p>{confirmation.description}</p>
            <dl className="confirm-terms">
              <div><dt>Loan</dt><dd className="mono">{loan.id}</dd></div>
              <div><dt>Principal</dt><dd className="num">{formatMoney(loan.principal)}</dd></div>
              <div><dt>Current status</dt><dd><StatusBadge value={loan.status} /></dd></div>
              <div><dt>Next due</dt><dd>{formatDate(loan.nextDue)}</dd></div>
            </dl>
            {confirmingAction === "unimpair" ? <div className="decision-warning">Unimpair is not yet verified on the live ledger. Any API error will be shown without changing this loan.</div> : null}
            <div className="button-row confirm-actions">
              <button className={`button ${confirmation.danger ? "button--danger" : "button--primary"}`} type="button" autoFocus onClick={() => { const action = confirmingAction; setConfirmingAction(null); onAction(action); }}>Confirm {confirmation.label.toLowerCase()}</button>
              <button className="button button--secondary" type="button" onClick={() => setConfirmingAction(null)}>Cancel</button>
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}

function LoansView({ loans, selected, error, pendingAction, receipt, onSelect, onAction, onClose }: { loans: LoanView[]; selected: LoanView | null; error: string | null; pendingAction: LoanAction | null; receipt: LoanActionReceipt | null; onSelect: (loan: LoanView) => void; onAction: (action: LoanAction) => void; onClose: () => void }) {
  return (
    <div className="loans-view">
      {receipt ? (
        <div className="loan-action-receipt" role="status">
          <span><strong>{loanActionCopy[receipt.action].label} recorded</strong><small>{receipt.loanId} · {formatDate(receipt.confirmedAt)}</small></span>
          {receipt.txHash ? <a href={explorerUrl(receipt.txHash)} target="_blank" rel="noreferrer">Open transaction on XRPL Explorer</a> : <span>Sample action complete. Live API transaction hash not available.</span>}
        </div>
      ) : null}
      <div className={`split-view ${selected ? "split-view--detail" : ""}`}>
        <Panel title="Loan book" action={<span className="queue-count">{formatNumber(loans.length)} loans</span>} className="list-pane"><LoansTable loans={loans} selectedId={selected?.id} onSelect={onSelect} /></Panel>
        {selected ? <LoanDetail key={selected.id} loan={selected} error={error} pendingAction={pendingAction} onAction={onAction} onBack={onClose} /> : <aside className="detail-pane detail-pane--empty"><p>Select a loan to inspect its payment state and available ledger actions.</p></aside>}
      </div>
    </div>
  );
}

function AgentView({
  agent,
  audit,
  live,
  pendingAction,
  policyNotice,
  delegationNotice,
  error,
  onToggle,
  onSavePolicy,
  onToggleDelegation,
}: {
  agent: AgentState;
  audit: AuditEntry[];
  live: boolean;
  pendingAction: AgentAction | null;
  policyNotice: string | null;
  delegationNotice: string | null;
  error: string | null;
  onToggle: () => Promise<void>;
  onSavePolicy: (minimumScore: number, maxLiquidityPercent: number) => Promise<void>;
  onToggleDelegation: () => Promise<void>;
}) {
  const [minimumScore, setMinimumScore] = useState(String(agent.minimumScore));
  const [maxLiquidityPercent, setMaxLiquidityPercent] = useState(String(agent.maxLiquidityPercent));
  const [policyError, setPolicyError] = useState<string | null>(null);

  async function savePolicy(event: FormEvent) {
    event.preventDefault();
    const nextMinimumScore = Number(minimumScore);
    const nextMaxLiquidityPercent = Number(maxLiquidityPercent);
    const validationError = agentPolicyError(nextMinimumScore, nextMaxLiquidityPercent);
    setPolicyError(validationError);
    if (validationError) return;
    await onSavePolicy(nextMinimumScore, nextMaxLiquidityPercent);
  }

  function downloadAuditCsv() {
    const url = URL.createObjectURL(new Blob([auditToCsv(audit)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "broker-audit.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="agent-layout">
      {error ? <div className="inline-error agent-error" role="alert">{error}</div> : null}
      <section className="settings-row">
        <div className="settings-copy"><h2>Underwriting agent</h2><p>Pause automated scoring without changing broker approval controls.</p></div>
        <div className="settings-panel">
          <div className="switch-row"><div><span>Agent status</span><StatusBadge value={agent.running ? "running" : "paused"} /><p>{live ? "Pause and resume are not in the shared API contract yet." : agent.running ? "New applications are scored as they arrive." : "Every application waits for a broker decision."}</p></div><button type="button" className={`switch ${agent.running ? "switch--on" : ""}`} role="switch" aria-label="Underwriting agent running" aria-checked={agent.running} disabled={live || pendingAction !== null} onClick={() => void onToggle()}><span /></button></div>
          <dl className="settings-values"><div><dt>Delegation</dt><dd>{agent.delegationActive ? "Active" : "Not active"}</dd></div><div><dt>Auto-approve</dt><dd>{agent.autoApprove ? "On" : "Off"}</dd></div><div><dt>Policy version</dt><dd>{agent.policyVersion}</dd></div></dl>
        </div>
      </section>
      <section className="settings-row">
        <div className="settings-copy"><h2>Approval policy</h2><p>The agent recommends; a human broker still approves every loan.</p></div>
        <form className="settings-panel policy-grid" onSubmit={savePolicy}>
          <label>Minimum score<input type="number" min="0" max="100" step="1" value={minimumScore} onChange={(event) => setMinimumScore(event.target.value)} disabled={pendingAction !== null} /></label>
          <label>Maximum liquidity per loan (%)<input type="number" min="0.01" max="100" step="0.01" value={maxLiquidityPercent} onChange={(event) => setMaxLiquidityPercent(event.target.value)} disabled={live || pendingAction !== null} />{live ? <small>Not included in the shared policy contract yet.</small> : null}</label>
          {policyError ? <div className="inline-error policy-message" role="alert">{policyError}</div> : null}
          {policyNotice ? <div className="settings-notice policy-message" role="status">{policyNotice}</div> : null}
          <button className="button button--primary" type="submit" disabled={pendingAction !== null}>{pendingAction === "policy" ? "Saving…" : "Save policy"}</button>
        </form>
      </section>
      <section className="settings-row">
        <div className="settings-copy"><h2>Two-key approval</h2><p>Feature 3 will require both the agent and broker to sign a loan.</p></div>
        <div className="settings-panel">
          <div className="switch-row"><div><span>Delegated signing</span><StatusBadge value={agent.delegationActive ? "active" : "inactive"} label={agent.delegationActive ? "Active" : "Not active"} /><p>The ledger capability decides whether this control can remain enabled.</p></div><button type="button" className={`switch ${agent.delegationActive ? "switch--on" : ""}`} role="switch" aria-label="Two-key approval" aria-checked={agent.delegationActive} disabled={pendingAction !== null} onClick={() => void onToggleDelegation()}><span /></button></div>
          {delegationNotice ? <div className="feature-notice" role="status">{delegationNotice}</div> : null}
        </div>
      </section>
      <Panel title="Audit log" action={<button className="button button--secondary button--small" type="button" onClick={downloadAuditCsv} disabled={!audit.length}>Download CSV</button>}>
        {audit.length ? <div className="table-wrap"><table aria-label="Broker audit log"><thead><tr><th>Time</th><th>Actor</th><th>Title</th><th>Detail</th><th>Application or loan</th><th>Receipt</th></tr></thead><tbody>{audit.map((entry) => <tr key={entry.id}><td><time dateTime={entry.at}>{formatDate(entry.at)}</time></td><td>{entry.actor}</td><td>{entry.action}</td><td className="audit-detail">{entry.reason}</td><td className="mono">{entry.subject}</td><td>{entry.txHash ? <a href={explorerUrl(entry.txHash)} target="_blank" rel="noreferrer">Explorer</a> : "—"}</td></tr>)}</tbody></table></div> : <div className="empty-state">No broker or agent events have been recorded.</div>}
      </Panel>
    </div>
  );
}

export function BrokerApp() {
  const previewFromUrl = new URLSearchParams(window.location.search).get("preview") === "1";
  const [brokerKey, setBrokerKey] = useState(() => sessionStorage.getItem("xrpl-broker-key") ?? "");
  const [preview, setPreview] = useState(previewFromUrl);
  const [tab, setTab] = useState<BrokerTab>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [applications, setApplications] = useState(demoApplications);
  const [loans, setLoans] = useState(demoLoans);
  const [snapshot, setSnapshot] = useState(demoSnapshot);
  const [agent, setAgent] = useState(demoAgent);
  const [audit, setAudit] = useState(demoAudit);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<ApplicationDecision | null>(null);
  const [pendingLoanAction, setPendingLoanAction] = useState<LoanAction | null>(null);
  const [loanActionReceipt, setLoanActionReceipt] = useState<LoanActionReceipt | null>(null);
  const [pendingCoverAction, setPendingCoverAction] = useState<CoverAction | null>(null);
  const [coverNotice, setCoverNotice] = useState<string | null>(null);
  const [pendingAgentAction, setPendingAgentAction] = useState<AgentAction | null>(null);
  const [policyNotice, setPolicyNotice] = useState<string | null>(null);
  const [delegationNotice, setDelegationNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [initializing, setInitializing] = useState(() => !sampleMode && Boolean(sessionStorage.getItem("xrpl-broker-key")));
  const [alertCheckedAt, setAlertCheckedAt] = useState(() => Date.now());
  const [alertError, setAlertError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertView[]>([{ loanId: "LN-2308", message: "Payment overdue" }]);

  const selectedApplication = applications.find((application) => application.id === selectedApplicationId) ?? null;
  const selectedLoan = loans.find((loan) => loan.id === selectedLoanId) ?? null;
  const pendingCount = applications.filter((application) => application.status === "pending_review").length;

  const refreshBrokerData = useCallback(async () => {
    if (sampleMode || preview || !brokerKey) {
      setInitializing(false);
      return;
    }

    setApiBrokerKey(brokerKey);
    const [broker, revenue, vault, nextApplications, nextLoans, nextAgent, nextAudit, nextAlerts] = await Promise.all([
      api.broker(),
      api.revenue(),
      api.vault(),
      api.applications(),
      api.loans(),
      api.agent(),
      api.audit(),
      api.alerts(),
    ]);
    setSnapshot(snapshotFromContract(broker, revenue, vault));
    setApplications(nextApplications.map(applicationFromContract));
    setLoans(nextLoans.map(loanFromContract));
    setAgent(agentFromContract(nextAgent));
    setAudit(nextAudit.map(auditFromContract));
    setAlerts(nextAlerts.map(alertFromContract));
    setAlertCheckedAt(Date.now());
    setAlertError(null);
    setInitializing(false);
  }, [brokerKey, preview]);

  const pollAlerts = useCallback(async () => {
    setAlertCheckedAt(Date.now());
    if (sampleMode || preview) {
      setAlertError(null);
      setInitializing(false);
      return;
    }
    try {
      setApiBrokerKey(brokerKey);
      const result = await api.alerts();
      setAlerts(result.map(alertFromContract));
      setAlertError(null);
    } catch (error) {
      setAlertError(error instanceof Error ? error.message : "Could not refresh alerts.");
    } finally {
      setInitializing(false);
    }
  }, [brokerKey, preview]);

  useEffect(() => {
    if (!brokerKey && !preview) return;

    const initialPoll = window.setTimeout(() => {
      void refreshBrokerData().catch((error: unknown) => {
        setAlertError(error instanceof Error ? error.message : "Could not load broker data.");
        setInitializing(false);
      });
    }, 0);
    const interval = window.setInterval(() => void pollAlerts(), 10_000);
    return () => {
      window.clearTimeout(initialPoll);
      window.clearInterval(interval);
    };
  }, [brokerKey, pollAlerts, preview, refreshBrokerData]);

  const finding = useMemo(() => {
    if (alerts.length) return `${formatNumber(alerts.length)} overdue loan${alerts.length === 1 ? "" : "s"} need${alerts.length === 1 ? "s" : ""} attention.`;
    if (pendingCount) return `${formatNumber(pendingCount)} application${pendingCount === 1 ? " is" : "s are"} waiting for a broker decision.`;
    return "No urgent broker actions.";
  }, [alerts.length, pendingCount]);

  function unlock(key: string) {
    sessionStorage.setItem("xrpl-broker-key", key);
    setApiBrokerKey(key);
    if (!sampleMode) setInitializing(true);
    setBrokerKey(key);
  }

  function openPreview() {
    setInitializing(false);
    setPreview(true);
    window.history.replaceState(null, "", "/broker?preview=1");
  }

  function selectTab(next: BrokerTab) {
    setTab(next);
    setMenuOpen(false);
    setActionError(null);
  }

  function openApplication(application: ApplicationView) {
    setSelectedApplicationId(application.id);
    setReviewNote("");
    setActionError(null);
    setTab("applications");
  }

  function openLoan(loan: LoanView) {
    setSelectedLoanId(loan.id);
    setActionError(null);
    setTab("loans");
  }

  async function runAction(action: () => void | Promise<void>) {
    setRefreshing(true);
    try {
      if (sampleMode || preview) await new Promise((resolve) => window.setTimeout(resolve, 650));
      await action();
    } finally {
      setRefreshing(false);
    }
  }

  async function approveApplication() {
    if (!selectedApplication || pendingDecision) return;
    const application = selectedApplication;
    const validationError = applicationDecisionError(application, "approve");
    if (validationError) return setActionError(validationError);

    setActionError(null);
    setPendingDecision("approve");
    setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status: "originating" } : item));

    try {
      await runAction(async () => {
        if (!sampleMode && !preview) {
          await api.approve(Number(application.id));
          await refreshBrokerData();
          return;
        }
        setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status: "approved" } : item));
        setAudit((current) => [{ id: `AUD-${Date.now()}`, at: new Date().toISOString(), actor: "broker", action: "Application approved", subject: application.id, reason: reviewNote || "Broker approved agent recommendation" }, ...current]);
      });
    } catch (error) {
      setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status: "pending_review" } : item));
      setActionError(error instanceof Error ? error.message : "Could not approve this application.");
    } finally {
      setPendingDecision(null);
    }
  }

  async function rejectApplication() {
    if (!selectedApplication || pendingDecision) return;
    const application = selectedApplication;
    const note = reviewNote.trim();
    const validationError = applicationDecisionError(application, "reject", note);
    if (validationError) return setActionError(validationError);

    setActionError(null);
    setPendingDecision("reject");

    try {
      await runAction(async () => {
        if (!sampleMode && !preview) {
          await api.reject(Number(application.id), note);
          await refreshBrokerData();
          return;
        }
        setApplications((current) => current.map((item) => item.id === application.id ? { ...item, status: "rejected" } : item));
        setAudit((current) => [{ id: `AUD-${Date.now()}`, at: new Date().toISOString(), actor: "broker", action: "Rejected application", subject: application.id, reason: note }, ...current]);
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not reject this application.");
    } finally {
      setPendingDecision(null);
    }
  }

  async function manageLoan(action: LoanAction) {
    if (!selectedLoan || pendingLoanAction) return;
    const loan = selectedLoan;
    const validationError = loanActionError(loan, action);
    if (validationError) return setActionError(validationError);

    const nextStatus: Record<Exclude<LoanAction, "delete">, LoanStatus> = { impair: "impaired", default: "defaulted", unimpair: "active" };
    setActionError(null);
    setLoanActionReceipt(null);
    setPendingLoanAction(action);

    try {
      await runAction(async () => {
        if (!sampleMode && !preview) {
          const receipt = await api.manageLoan(loan.id, action);
          await refreshBrokerData();
          setLoanActionReceipt({ loanId: loan.id, action, confirmedAt: new Date().toISOString(), txHash: receipt.hash });
          return;
        }
        if (action === "delete") {
          setLoans((current) => current.filter((item) => item.id !== loan.id));
          setSelectedLoanId(null);
        } else {
          setLoans((current) => current.map((item) => item.id === loan.id ? { ...item, status: nextStatus[action] } : item));
        }
        if (action === "impair" || action === "default" || action === "delete") {
          setAlerts((current) => current.filter((alert) => alert.loanId !== loan.id));
        }
        const confirmedAt = new Date().toISOString();
        setLoanActionReceipt({ loanId: loan.id, action, confirmedAt });
        setAudit((current) => [{ id: `AUD-${Date.now()}`, at: confirmedAt, actor: "broker", action: loanActionCopy[action].label, subject: loan.id, reason: "Broker action from loan detail" }, ...current]);
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Could not ${loanActionCopy[action].label.toLowerCase()}.`);
    } finally {
      setPendingLoanAction(null);
    }
  }

  async function adjustCover(action: CoverAction, amount: number) {
    if (pendingCoverAction) return;
    const validationError = coverAdjustmentError(snapshot, action, amount);
    if (validationError) return setActionError(validationError);

    setActionError(null);
    setCoverNotice(null);
    setPendingCoverAction(action);

    try {
      await runAction(async () => {
        if (!sampleMode && !preview) {
          if (action === "deposit") await api.coverDeposit(String(amount));
          else await api.coverWithdraw(String(amount));
          await refreshBrokerData();
          setCoverNotice(`${action === "deposit" ? "Deposited" : "Withdrew"} cover: ${formatMoney(amount)}.`);
          return;
        }
        setSnapshot((current) => ({
          ...current,
          coverAvailable: coverAfterAdjustment(current, action, amount),
        }));
        const confirmedAt = new Date().toISOString();
        const actionLabel = action === "deposit" ? "Deposited cover" : "Withdrew cover";
        setCoverNotice(`${actionLabel}: ${formatMoney(amount)}.`);
        setAudit((current) => [{
          id: `AUD-${Date.now()}`,
          at: confirmedAt,
          actor: "broker",
          action: actionLabel,
          subject: "First-loss cover",
          reason: `${formatMoney(amount)} from broker overview`,
        }, ...current]);
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update first-loss cover.");
    } finally {
      setPendingCoverAction(null);
    }
  }

  async function toggleAgent() {
    if (pendingAgentAction) return;
    if (!sampleMode && !preview) {
      setActionError("Pause and resume are not part of the shared API contract yet.");
      return;
    }
    const running = !agent.running;
    setActionError(null);
    setPendingAgentAction("status");

    try {
      await runAction(() => {
        const at = new Date().toISOString();
        setAgent((current) => ({ ...current, running }));
        setAudit((current) => [{
          id: `AUD-${Date.now()}`,
          at,
          actor: "broker",
          action: running ? "Agent resumed" : "Agent paused",
          subject: "Underwriting agent",
          reason: running ? "Automated scoring resumed" : "Every application now waits for broker review",
        }, ...current]);
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update the underwriting agent.");
    } finally {
      setPendingAgentAction(null);
    }
  }

  async function saveAgentPolicy(minimumScore: number, maxLiquidityPercent: number) {
    if (pendingAgentAction) return;
    const validationError = agentPolicyError(minimumScore, maxLiquidityPercent);
    if (validationError) return setActionError(validationError);
    setActionError(null);
    setPolicyNotice(null);
    setPendingAgentAction("policy");
    const savedVersion = nextPolicyVersion(agent.policyVersion);

    try {
      await runAction(async () => {
        if (!sampleMode && !preview) {
          await api.setPolicy({ minScore: minimumScore });
          await refreshBrokerData();
          setPolicyNotice("Policy saved to the lending API.");
          return;
        }
        const at = new Date().toISOString();
        setAgent((current) => ({ ...current, minimumScore, maxLiquidityPercent, policyVersion: savedVersion }));
        setPolicyNotice(`Policy saved as ${savedVersion}.`);
        setAudit((current) => [{
          id: `AUD-${Date.now()}`,
          at,
          actor: "broker",
          action: "Policy updated",
          subject: "Agent policy",
          reason: `Minimum score ${minimumScore}; maximum ${formatPercent(maxLiquidityPercent)} of available funds`,
        }, ...current]);
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not save the agent policy.");
    } finally {
      setPendingAgentAction(null);
    }
  }

  async function toggleDelegation() {
    if (pendingAgentAction) return;
    setActionError(null);
    setDelegationNotice(null);
    setPendingAgentAction("delegation");

    try {
      await runAction(async () => {
        if (!sampleMode && !preview) {
          const enabled = !agent.delegationActive;
          const receipt = await api.setDelegation({ enabled });
          await refreshBrokerData();
          setDelegationNotice(receipt ? `Two-key approval ${enabled ? "enabled" : "disabled"}.` : "Two-key approval is not available on the ledger yet.");
          return;
        }
        if (agent.delegationActive) {
          setAgent((current) => ({ ...current, delegationActive: false }));
          setDelegationNotice("Two-key approval is off.");
          return;
        }
        setDelegationNotice("Coming next: the ledger will require both the agent and the broker to sign every loan.");
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not update two-key approval.");
    } finally {
      setPendingAgentAction(null);
    }
  }

  if (!brokerKey && !preview) return <BrokerGate onUnlock={unlock} onPreview={openPreview} />;

  return (
    <div className="app-shell">
      <header className="mobile-header"><button type="button" onClick={() => setMenuOpen(true)}>Menu</button><strong>XRPL Lending</strong><span>{formatNumber(pendingCount)}</span></header>
      <aside className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}>
        <button className="sidebar-close" type="button" onClick={() => setMenuOpen(false)}>Close</button>
        <div className="product-lockup"><span className="product-mark" aria-hidden="true"><span /></span><span>XRPL Lending</span></div>
        <div className="workspace-label"><span>Broker workspace</span><strong>Devnet operations</strong></div>
        <nav aria-label="Broker navigation">
          {tabs.map((item) => (
            <button className={tab === item.id ? "nav-item nav-item--active" : "nav-item"} type="button" key={item.id} onClick={() => selectTab(item.id)}>
              <span>{item.label}</span>{item.id === "applications" && pendingCount ? <b>{formatNumber(pendingCount)}</b> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-meta"><span className="signal-dot signal-dot--blue" />{preview || sampleMode ? "Sample XRP data" : "Live lending data"}<small>Alerts checked {formatDate(new Date(alertCheckedAt).toISOString())}</small></div>
      </aside>
      {menuOpen ? <button className="menu-scrim" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)} /> : null}
      <main className="canvas">
        <header className="page-header">
          <div><h1>{tabs.find((item) => item.id === tab)?.label}</h1><p>{tab === "overview" ? finding : "Broker controls for the live XRPL lending flow."}</p></div>
          <div className="freshness"><span>{refreshing ? "Updating…" : alertError ? "Needs attention" : "Up to date"}</span><button type="button" disabled={refreshing} onClick={() => void runAction(refreshBrokerData)}>Refresh</button></div>
        </header>
        {initializing ? <BrokerSkeleton /> : (
          <>
            {agent.running ? null : <div className="paused-banner">Agent paused: every application waits for you.</div>}
            <div hidden={tab !== "overview"}>
              <Overview applications={applications} loans={loans} alerts={alerts} alertError={alertError} snapshot={snapshot} pendingCoverAction={pendingCoverAction} coverNotice={coverNotice} onApplication={openApplication} onLoan={openLoan} onNavigate={selectTab} onAdjustCover={adjustCover} onRefreshAlerts={() => void runAction(pollAlerts)} />
            </div>
            <div hidden={tab !== "applications"}>
              <ApplicationsView applications={applications} selected={selectedApplication} note={reviewNote} error={actionError} pendingDecision={pendingDecision} onSelect={openApplication} onNote={setReviewNote} onApprove={() => void approveApplication()} onReject={() => void rejectApplication()} onClose={() => setSelectedApplicationId(null)} />
            </div>
            <div hidden={tab !== "loans"}>
              <LoansView loans={loans} selected={selectedLoan} error={actionError} pendingAction={pendingLoanAction} receipt={loanActionReceipt} onSelect={openLoan} onAction={(action) => void manageLoan(action)} onClose={() => setSelectedLoanId(null)} />
            </div>
            <div hidden={tab !== "agent"}>
              <AgentView agent={agent} audit={audit} live={!sampleMode && !preview} pendingAction={pendingAgentAction} policyNotice={policyNotice} delegationNotice={delegationNotice} error={actionError} onToggle={toggleAgent} onSavePolicy={saveAgentPolicy} onToggleDelegation={toggleDelegation} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
