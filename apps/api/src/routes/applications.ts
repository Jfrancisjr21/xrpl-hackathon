import { createHash } from "node:crypto";
import { Router } from "express";
import { ApplicationIdParam, ApplicationQuery, BrokerNote, LoanApplicationInput } from "@hack/shared";
import type { Deps } from "../app";
import { audit, createApplication, getApplication, getConfig, listApplications, toView, transition } from "../db/db";
import { HttpError, requireBrokerKey, validate } from "../middleware";

const OPEN = ["pending_review", "originating", "active"];

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
