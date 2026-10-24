import { Router } from "express";
import { CoverMove, platformFeeOn, type BrokerView, type RevenueView } from "@hack/shared";
// shortcut: the fee constants are not exported from @hack/ledger's index yet; ask Juan to export them.
import { ORIGINATION_FEE } from "@hack/ledger/src/loan";
import type { Deps } from "../app";
import { audit, listAudit, originatedLoanCount, paymentTotals } from "../db/db";
import { onLedger, requireBrokerKey, validate } from "../middleware";

export function brokerRouter({ db, ledger }: Deps) {
  const router = Router();
  router.use(requireBrokerKey); // the whole broker area is behind the key

  // Cover health: the ledger stops new loans and fees when cover drops below the minimum.
  router.get("/", async (_req, res) => {
    const b = await onLedger(() => ledger.getBroker());
    const coverRequired = (Number(b.debtTotal) * b.coverRateMinimum) / 100000;
    const body: BrokerView = {
      ...b,
      coverRequired: String(coverRequired),
      coverHealthy: Number(b.coverAvailable) >= coverRequired,
    };
    res.json(body);
  });

  const cover = (kind: "deposit" | "withdraw") =>
    router.post(`/cover/${kind}`, validate({ body: CoverMove }), async (req, res) => {
      const { amount } = req.body as CoverMove;
      const tx = await onLedger(() => (kind === "deposit" ? ledger.depositCover(amount) : ledger.withdrawCover(amount)));
      audit(db, { actor: "broker", action: kind === "deposit" ? "cover_deposit" : "cover_withdraw", tx, note: amount });
      res.json(tx);
    });
  cover("deposit");
  cover("withdraw");

  // R10: revenue from recorded payments. Revenue is reporting only; it never feeds approval.
  router.get("/revenue", async (_req, res) => {
    const { managementFeeRate } = await onLedger(() => ledger.getBroker());
    const totals = paymentTotals(db);
    const interest = totals.interest.toFixed(2);
    const platformFees = platformFeeOn(interest, managementFeeRate);
    const body: RevenueView = {
      interestCollected: interest,
      platformFees,
      depositorShare: (Number(interest) - Number(platformFees)).toFixed(2),
      paymentsCount: totals.count,
      managementFeeRate,
      serviceFees: totals.serviceFees.toFixed(2),
      originationFees: (originatedLoanCount(db) * Number(ORIGINATION_FEE)).toFixed(2),
    };
    res.json(body);
  });

  router.get("/audit", (_req, res) => {
    res.json(listAudit(db));
  });

  return router;
}
