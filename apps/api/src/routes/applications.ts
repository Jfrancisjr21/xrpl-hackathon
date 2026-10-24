import { createHash } from "node:crypto";
import { Router } from "express";
import { LedgerNotReadyError } from "@hack/ledger";
import { ApplicationIdParam, ApplicationQuery, BrokerNote, LoanApplicationInput, type Decision } from "@hack/shared";
import type { Deps } from "../app";
import { audit, createApplication, getApplication, getConfig, listApplications, toView, transition } from "../db/db";
import { HttpError, LedgerError, requireBrokerKey, validate } from "../middleware";

const OPEN = ["pending_review", "originating", "active"];

// Payment interval and grace period. DEMO_FAST_LOANS makes payments due every 60 s so impair and default can be shown live.
export function loanTiming() {
  const seconds = process.env.DEMO_FAST_LOANS === "true" ? 60 : 30 * 24 * 60 * 60;
  return { paymentIntervalSec: seconds, gracePeriodSec: seconds };
}

export function applicationsRouter({ db, ledger, underwrite }: Deps) {
  const router = Router();

  // Borrower applies. Underwriting decides; a yes waits for the broker, a no is final.
  router.post("/", validate({ body: LoanApplicationInput }), async (req, res) => {
    const input = req.body as LoanApplicationInput;

    if (getConfig(db, "paused") === "true") throw new HttpError(409, "The underwriting agent is paused, so new applications are not accepted right now");
    // The backend signs for borrowers in this demo, so only demo wallets can borrow.
    if (!ledger.getWallets().some((w) => w.address === input.borrowerAddress)) {
      throw new HttpError(400, "Unknown borrower", { fields: { borrowerAddress: "must be one of the demo wallets from GET /api/wallets" } });
    }
    // R11, checked before underwriting so a duplicate never costs a credit pull. The database enforces it again on insert.
    if (listApplications(db, { borrower: input.borrowerAddress }).some((a) => OPEN.includes(a.status))) {
      throw new HttpError(409, "This borrower already has an application in review, originating or active");
    }

    const decision = await underwrite(input);
    const decisionHash = createHash("sha256").update(JSON.stringify(decision)).digest("hex"); // Feature 1
    const row = createApplication(db, {
      borrowerAddress: input.borrowerAddress,
      amount: input.amount,
      paymentTotal: input.paymentTotal,
      status: decision.approved ? "pending_review" : "denied",
      decision,
      decisionHash,
    });
    audit(db, { actor: "agent", action: "application_decided", applicationId: row.id, note: decision.reasons.join("; ") });
    res.status(201).json(toView(row));
  });

  router.get("/", validate({ query: ApplicationQuery }), (req, res) => {
    const { status, borrower } = req.query as ApplicationQuery;
    res.json(listApplications(db, { status, borrower }).map(toView));
  });

  router.get("/:id", validate({ params: ApplicationIdParam }), (req, res) => {
    const id = req.params.id as unknown as number;
    const row = getApplication(db, id);
    if (!row) throw new HttpError(404, `Application ${id} not found`);
    res.json(toView(row));
  });

  // Broker approves: originate the loan on the ledger. pending_review -> originating -> active | failed.
  router.post("/:id/approve", requireBrokerKey, validate({ params: ApplicationIdParam }), async (req, res) => {
    const id = req.params.id as unknown as number;
    const row = getApplication(db, id);
    if (!row) throw new HttpError(404, `Application ${id} not found`);
    const decision = JSON.parse(row.decision_json) as Decision;
    if (decision.interestRate === null) throw new HttpError(409, `Application ${id} has no priced decision, so it cannot be originated`);

    // Claim it before the slow ledger call, so a second approve during signing gets 409 and nothing is originated twice.
    if (!transition(db, id, ["pending_review"], "originating")) {
      throw new HttpError(409, `Application ${id} is ${row.status}, so it cannot be approved`);
    }

    try {
      const { loanId, tx } = await ledger.originateLoan({
        borrower: row.borrower_address,
        principal: row.amount,
        interestRate: decision.interestRate,
        paymentTotal: row.payment_total,
        ...loanTiming(),
        decisionMemo: row.decision_hash ?? undefined, // Feature 1: the decision hash travels with the LoanSet
      });
      const active = transition(db, id, ["originating"], "active", { loanId, tx })!;
      audit(db, { actor: "broker", action: "application_approved", applicationId: id });
      audit(db, { actor: "broker", action: "loan_originated", applicationId: id, loanId, tx });
      res.json(toView(active));
    } catch (e) {
      if (e instanceof LedgerNotReadyError) {
        transition(db, id, ["originating"], "pending_review"); // not a failure: the broker can approve again later
        throw e; // 409 with opensAt
      }
      const message = e instanceof Error ? e.message : String(e);
      transition(db, id, ["originating"], "failed", { error: message });
      audit(db, { actor: "broker", action: "loan_failed", applicationId: id, note: message });
      throw new LedgerError(message); // 502
    }
  });

  // Broker rejects with a reason. Only a pending_review application can be rejected.
  router.post("/:id/reject", requireBrokerKey, validate({ params: ApplicationIdParam, body: BrokerNote }), (req, res) => {
    const id = req.params.id as unknown as number;
    const { note } = req.body as BrokerNote;
    const row = getApplication(db, id);
    if (!row) throw new HttpError(404, `Application ${id} not found`);
    const moved = transition(db, id, ["pending_review"], "rejected", { brokerNote: note });
    if (!moved) throw new HttpError(409, `Application ${id} is ${row.status}, so it cannot be rejected`);
    audit(db, { actor: "broker", action: "application_rejected", applicationId: id, note });
    res.json(toView(moved));
  });

  return router;
}
