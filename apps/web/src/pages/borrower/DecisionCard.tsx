import { estimateLoan, type ApplicationView } from "@hack/shared";
import { amount, pct } from "../../lib/format";
import { StatusBadge } from "../../components/StatusBadge";
import { CopyButton } from "../../components/CopyButton";
import { verdictOf } from "./status";

// The server sets the payment interval; with DEMO_FAST_LOANS it is 60 seconds, so estimates use that.
const DEMO_INTERVAL_SEC = 60;
const PARTS = [
  { key: "age", label: "Account age", max: 30 },
  { key: "activity", label: "Activity", max: 30 },
  { key: "trustlines", label: "Trust lines", max: 20 },
  { key: "credential", label: "Verified credential", max: 20 },
] as const;
const badgeValue = { Approved: "approved", Denied: "rejected", Blocked: "flagged" } as const;

/** What the agent decided and why: verdict, score, sanctions, rate, the loan's cost and the decision receipt. */
export function DecisionCard({ app, assetLabel }: { app: ApplicationView; assetLabel: string }) {
  const d = app.decision;
  const verdict = verdictOf(d);
  const est = d.approved && d.interestRate !== null
    ? estimateLoan({ principal: app.amount, interestRate: d.interestRate, paymentTotal: app.paymentTotal, paymentIntervalSec: DEMO_INTERVAL_SEC })
    : null;

  return (
    <section className="card decision" aria-label="Decision">
      <div className="decision-head">
        <h2>Decision</h2>
        <StatusBadge value={badgeValue[verdict]} label={verdict} />
      </div>

      {d.score ? (
        <div className="score">
          <div className="score-line">
            <span>Score</span>
            <b className="num">{d.score.total} / 100</b>
            <span className="score-min">minimum {d.minScore}</span>
          </div>
          <div className="score-bar" role="img" aria-label={`Score ${d.score.total} of 100, minimum ${d.minScore}`}>
            <span style={{ width: `${d.score.total}%` }} />
            <i style={{ left: `${d.minScore}%` }} />
          </div>
          <dl className="score-parts">
            {PARTS.map((p) => (
              <div key={p.key}><dt>{p.label}</dt><dd className="num">{d.score![p.key]} / {p.max}</dd></div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="hint">Not scored: the sanctions check stopped this application first.</p>
      )}

      <p className={d.sanctions.blocked ? "sanctions sanctions--blocked" : "sanctions"}>
        {d.sanctions.blocked
          ? <>Sanctions: <b>Blocked</b>, matches {d.sanctions.matchedEntry ?? "a listed entry"} ({d.sanctions.source === "demo" ? "DEMO list" : "OFAC SDN"}).</>
          : <>Sanctions: <b>Cleared</b> against the sanctions lists.</>}
      </p>

      {d.interestRate !== null && <p className="offer">Offered rate <b className="num">{pct(d.interestRate)}</b> a year</p>}
      <p className="explanation">{d.explanation}</p>
      {d.featureSource === "demo-profile" && <p className="hint">Seeded demo profile: these facts belong to a demo persona, not this wallet's ledger history.</p>}

      {est && (
        <div className="cost">
          <h3>Cost of this loan (estimate)</h3>
          <dl>
            <div><dt>Principal</dt><dd className="num">{amount(app.amount)} {assetLabel}</dd></div>
            <div><dt>Rate</dt><dd className="num">{pct(d.interestRate!)} a year</dd></div>
            <div><dt>Total interest</dt><dd className="num">{amount(est.totalInterest)} {assetLabel}</dd></div>
            <div><dt>of which platform fee (10%)</dt><dd className="num">{amount(est.platformFee)} {assetLabel}</dd></div>
            <div><dt>Each of {app.paymentTotal} payments</dt><dd className="num">{amount(est.periodicPayment)} {assetLabel}</dd></div>
          </dl>
          <p className="hint">Estimated with the demo's 60-second payments, before the ledger's service fee.</p>
        </div>
      )}

      {app.decisionHash && (
        <p className="decision-receipt">
          Decision receipt <code title={app.decisionHash}>{app.decisionHash.slice(0, 12)}</code>
          <CopyButton text={app.decisionHash} />
          {app.tx?.explorerUrl && <a href={app.tx.explorerUrl} target="_blank" rel="noreferrer">Verify on the ledger</a>}
        </p>
      )}
    </section>
  );
}
