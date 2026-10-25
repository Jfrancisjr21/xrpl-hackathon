import { Router } from "express";
import { AddressParam, CidParam, IssueScoreToken, type ScoreTokenView, type TxResult, type VerifyResult } from "@hack/shared";
import type { LedgerService } from "@hack/ledger";
import type { Deps } from "../app";
import { getApplication, latestScoreToken, type Db } from "../db/db";
import { HttpError, onLedger, requireBrokerKey, validate } from "../middleware";
import { issuePassport, revokePassport } from "../services/passport";

async function view(db: Db, ledger: LedgerService, address: string): Promise<ScoreTokenView> {
  const row = latestScoreToken(db, address);
  return {
    address,
    status: row?.status ?? null,
    applicationId: row?.application_id ?? null,
    ...(row?.mint_tx_json ? { mintTx: JSON.parse(row.mint_tx_json) as TxResult } : {}),
    ...(row?.move_tx_json ? { moveTx: JSON.parse(row.move_tx_json) as TxResult } : {}),
    ...(row?.error ? { error: row.error } : {}),
    onLedger: await onLedger(() => ledger.getScoreToken(address)),
  };
}

// GET /api/score-tokens/:address (public), POST /api/score-tokens and DELETE /api/score-tokens/:address (broker key).
export function scoreTokensRouter({ db, ledger }: Deps) {
  const router = Router();

  // Public: the score is already public on the ledger, and the borrower screen polls this while the mint runs.
  router.get("/:address", validate({ params: AddressParam }), async (req, res) => {
    res.json(await view(db, ledger, (req.params as unknown as AddressParam).address));
  });

  // Broker issues or reissues by hand (demo backup, or a retry after a failure). Waits for the ledger: 10 to 15 s.
  router.post("/", requireBrokerKey, validate({ body: IssueScoreToken }), async (req, res) => {
    const { applicationId, replace } = req.body as IssueScoreToken;
    const app = getApplication(db, applicationId);
    if (!app) throw new HttpError(404, `Application ${applicationId} not found`);
    if (app.status !== "active" || app.loan_outcome) throw new HttpError(409, `Application ${applicationId} has no active loan, so it cannot get a passport`);
    const last = latestScoreToken(db, app.borrower_address);
    if (last?.status === "pending") throw new HttpError(409, "A passport for this wallet is already being issued");
    if (!replace && (last?.status === "minted" || last?.status === "held")) {
      throw new HttpError(409, "This wallet already has a passport. Send replace: true to burn it and issue a new one");
    }
    await issuePassport(db, ledger, app);
    const v = await view(db, ledger, app.borrower_address);
    if (v.status === "failed") throw new HttpError(502, `Issuing the passport failed: ${v.error}`);
    res.status(201).json(v);
  });

  router.delete("/:address", requireBrokerKey, validate({ params: AddressParam }), async (req, res) => {
    const { address } = req.params as unknown as AddressParam;
    if (!(await revokePassport(db, ledger, address, "broker"))) throw new HttpError(404, "No passport on the ledger for this wallet");
    res.json(await view(db, ledger, address));
  });

  return router;
}

// GET /api/verify/:address: what another lender sees. Public and read from the ledger, so it works for any wallet.
export function verifyRouter({ db, ledger }: Deps) {
  const router = Router();
  router.get("/:address", validate({ params: AddressParam }), async (req, res) => {
    const { address } = req.params as unknown as AddressParam;
    const t = await onLedger(() => ledger.getScoreToken(address));
    if (!t) return res.json({ address, verified: false, reason: "no_token" } satisfies VerifyResult);
    const mintTx = latestScoreToken(db, address)?.mint_tx_json;
    const body: VerifyResult = {
      address,
      verified: !t.expired,
      ...(t.expired ? { reason: "expired" as const } : {}),
      token: {
        score: t.lcs, level: t.level, issuedAt: t.issuedAt, expiresAt: t.expiresAt,
        kyc: t.kyc, credit: t.credit, lending: t.lending, nftId: t.nftId, cid: t.cid, holder: t.holder,
        ...(mintTx ? { txUrl: (JSON.parse(mintTx) as TxResult).explorerUrl } : {}),
      },
    };
    res.json(body);
  });
  return router;
}

// GET /api/passports/:cid: the raw record behind the NFT's ipfs:// URI. A verifier can hash these bytes to check the CID.
export function passportsRouter({ ledger }: Deps) {
  const router = Router();
  router.get("/:cid", validate({ params: CidParam }), async (req, res) => {
    const bytes = await onLedger(() => ledger.getScoreRecord((req.params as unknown as CidParam).cid));
    if (!bytes) throw new HttpError(404, "No passport record for this CID");
    res.type("application/json").send(bytes);
  });
  return router;
}
