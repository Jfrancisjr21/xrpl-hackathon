import type { ScoreTokenView } from "@hack/shared";
import { api } from "../../lib/api";
import { usePoll } from "../../lib/hooks";
import { date } from "../../lib/format";
import { StatusBadge } from "../../components/StatusBadge";
import { TxReceipt } from "../../components/TxReceipt";

const flag = (ok: boolean, label: string) => <StatusBadge value={ok ? "clear" : "review"} label={`${label} ${ok ? "✓" : "—"}`} />;

/** Feature 5: the borrower's score passport. Polls every 5 s, so "Issuing" turns into the token on its own. */
export function ScorePassport({ address }: { address: string }) {
  const { data, error } = usePoll<ScoreTokenView>(() => api.scoreToken(address), [address], 5000);
  if (!data || data.status === null) return null; // never issued for this wallet
  const t = data.onLedger;
  const state = t ? "On the ledger" : data.status === "failed" ? "Failed" : data.status === "revoked" ? "Revoked" : "Issuing";

  return (
    <section className="card" aria-label="Score passport">
      <div className="decision-head">
        <h2>Score passport</h2>
        <StatusBadge value={t ? "active" : data.status === "pending" ? "pending_review" : "failed"} label={state} />
      </div>
      {!t && data.status === "pending" && <p>Publishing your score to the ledger. This takes about 10 to 15 seconds.</p>}
      {!t && data.status === "failed" && <p className="hint">{data.error ?? "We could not publish your score."} The broker can retry.</p>}
      {!t && data.status === "revoked" && <p className="hint">This passport was withdrawn, for example after a defaulted loan.</p>}
      {t && (
        <>
          <dl className="score-parts">
            <div><dt>Ledger Credit Score</dt><dd className="num">{t.lcs} LCS</dd></div>
            <div><dt>Level</dt><dd>{t.level}</dd></div>
            <div><dt>Issued</dt><dd className="num">{date(t.issuedAt)}</dd></div>
            <div><dt>Valid until</dt><dd className="num">{date(t.expiresAt)}</dd></div>
            <div><dt>Held by</dt><dd>{t.holder === address ? "Your wallet" : "Our issuer (not moved yet)"}</dd></div>
          </dl>
          <p>{flag(t.kyc, "KYC")} {flag(t.credit, "Credit")} {flag(t.lending, "Lending")}</p>
          <TxReceipt tx={data.mintTx ?? null} label="Minted on Devnet" />
          <p className="hint">Any lender can check this wallet at <code>/api/verify/{address}</code>. No personal data is stored, only the score and these flags.</p>
        </>
      )}
      {error && <p className="hint">{error}</p>}
    </section>
  );
}
