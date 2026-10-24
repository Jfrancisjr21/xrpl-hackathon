import { Router } from "express";
import { LoanIdParam, LoanQuery, PayRequest, type LoanView, type PayMode, type PayResult } from "@hack/shared";
import type { Deps } from "../app";
import { audit, closeLoan, getApplicationByLoan, listApplications, recordPayment } from "../db/db";
import { HttpError, onLedger, requireBrokerKey, validate } from "../middleware";

const OPEN_FIRST = { active: 0, impaired: 1, defaulted: 2, paid: 3 } as const;

export function loansRouter({ db, ledger }: Deps) {
  const router = Router();

  // Our loans, read live from the ledger. Open ones first (R9), newest first within that.
  router.get("/", validate({ query: LoanQuery }), async (req, res) => {
    const { borrower } = req.query as LoanQuery;
    const rows = listApplications(db, { borrower }).filter((a) => a.loan_id);
    const loans = await Promise.all(
      rows.map(async (a): Promise<LoanView | null> => {
        try {
          return { ...(await ledger.getLoan(a.loan_id!)), applicationId: a.id };
        } catch {
          return null; // R2: deleted on the ledger, or gone after a Devnet reset; skip it instead of failing the list
        }
      }),
    );
    const found = loans.filter((l): l is LoanView => l !== null);
    for (const l of found) {
      const row = rows.find((a) => a.id === l.applicationId)!;
      if (l.status === "paid" && !row.loan_outcome) closeLoan(db, l.loanId, "paid"); // counts toward the borrower's history
    }
    res.json(found.sort((x, y) => OPEN_FIRST[x.status] - OPEN_FIRST[y.status]));
  });

  // The loan must be one we originated; anything else is a 404, not a ledger call.
  const ourLoan = (loanId: string) => {
    const row = getApplicationByLoan(db, loanId);
    if (!row) throw new HttpError(404, `Loan ${loanId} not found`);
    return row;
  };

  const pay = async (loanId: string, mode: PayMode): Promise<PayResult> => {
    const row = ourLoan(loanId);
    if (row.loan_outcome) throw new HttpError(409, `Loan is already ${row.loan_outcome}`);
    const { tx, amount } = await onLedger(() => ledger.payLoan(loanId, mode));
    recordPayment(db, { loanId, applicationId: row.id, mode, amount, txHash: tx.hash }); // R10
    audit(db, { actor: "borrower", action: "loan_paid", applicationId: row.id, loanId, tx, note: `${mode} ${amount}` });
    const after = await ledger.getLoan(loanId).catch(() => null);
    if (after?.status === "paid") closeLoan(db, loanId, "paid");
    return { tx, amount };
  };

  // The backend signs for the borrower in this demo.
  router.post("/:id/pay", validate({ params: LoanIdParam, body: PayRequest }), async (req, res) => {
    res.json(await pay(req.params.id as string, (req.body as PayRequest).mode));
  });

  // R3: one click pays the installment due.
  router.post("/:id/pay-due", validate({ params: LoanIdParam }), async (req, res) => {
    res.json(await pay(req.params.id as string, "installment"));
  });

  // Broker actions. The ledger only allows impair once a payment is late, and default after the grace period,
  // so check first and answer 409 with a clear reason instead of a ledger error.
  router.post("/:id/impair", requireBrokerKey, validate({ params: LoanIdParam }), async (req, res) => {
    const loanId = req.params.id as string;
    const row = ourLoan(loanId);
    const loan = await onLedger(() => ledger.getLoan(loanId));
    if (!loan.canImpair) throw new HttpError(409, `Loan is ${loan.status} and no payment is late yet, so it cannot be impaired`);
    const tx = await onLedger(() => ledger.manageLoan(loanId, "impair"));
    audit(db, { actor: "broker", action: "loan_impaired", applicationId: row.id, loanId, tx });
    res.json(tx);
  });

  router.post("/:id/default", requireBrokerKey, validate({ params: LoanIdParam }), async (req, res) => {
    const loanId = req.params.id as string;
    const row = ourLoan(loanId);
    const loan = await onLedger(() => ledger.getLoan(loanId));
    if (!loan.canDefault) throw new HttpError(409, `Loan is ${loan.status} and still within its grace period, so it cannot be defaulted`);
    const tx = await onLedger(() => ledger.manageLoan(loanId, "default"));
    closeLoan(db, loanId, "defaulted"); // also puts the borrower on the ban list
    audit(db, { actor: "broker", action: "loan_defaulted", applicationId: row.id, loanId, tx, note: `${row.borrower_address} added to the ban list` });
    res.json(tx);
  });

  return router;
}
