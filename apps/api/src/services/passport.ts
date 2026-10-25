import type { LedgerService } from "@hack/ledger";
import type { Decision } from "@hack/shared";
import { audit, finishScoreToken, latestScoreToken, startScoreToken, type ApplicationRow, type Db } from "../db/db";

// Feature 5: publish the score passport for an active loan (mint about 10 to 15 s, then move it to the borrower).
// Never throws: the outcome lands in score_tokens and the audit log, so the approve response never waits on it or breaks.
export async function issuePassport(db: Db, ledger: LedgerService, app: ApplicationRow): Promise<void> {
  const id = startScoreToken(db, app.id, app.borrower_address);
  try {
    const d = JSON.parse(app.decision_json) as Decision;
    const level = d.approvalLevel;
    if (!d.score) throw new Error("The decision has no score, so there is nothing to publish");
    if (level !== "A" && level !== "B" && level !== "C") throw new Error("Only unsecured loans at level A, B or C get a passport");
    if (!app.decision_hash) throw new Error("The application has no decision hash");
    const r = await ledger.issueScoreToken(app.borrower_address, {
      lcs: d.score.total,
      onChainScore: d.score.wallet ?? d.score.total,
      level,
      kyc: d.facts?.hasCredential ?? false,
      credit: d.credit?.fileFound === true,
      lending: app.status === "active",
      decisionHash: app.decision_hash,
    });
    finishScoreToken(db, id, { status: r.moveTx ? "held" : "minted", nftId: r.nftId, cid: r.cid, mintTx: r.tx, moveTx: r.moveTx });
    audit(db, { actor: "system", action: "score_token_issued", applicationId: app.id, tx: r.tx, note: `ipfs://${r.cid}` });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    finishScoreToken(db, id, { status: "failed", error: message });
    audit(db, { actor: "system", action: "score_token_failed", applicationId: app.id, note: message });
  }
}

// Burns the wallet's passport (a default, or the broker revoking it). Never throws, like issuePassport.
export async function revokePassport(db: Db, ledger: LedgerService, address: string, actor: "broker" | "system", applicationId?: number): Promise<boolean> {
  try {
    const tx = await ledger.revokeScoreToken(address);
    if (!tx) return false;
    const last = latestScoreToken(db, address);
    if (last) finishScoreToken(db, last.id, { status: "revoked" });
    audit(db, { actor, action: "score_token_revoked", applicationId: applicationId ?? last?.application_id, tx });
    return true;
  } catch (e) {
    console.error("score passport revoke:", (e as Error).message);
    return false;
  }
}
