import { Router } from "express";
import { z } from "zod";
import { Address, MoveFunds, type VaultView } from "@hack/shared";
import type { Deps } from "../app";
import { audit } from "../db/db";
import { HttpError, onLedger, validate } from "../middleware";

const VaultQuery = z.object({ address: Address.optional() }); // ?address= adds that wallet's position

export function vaultRouter({ db, ledger }: Deps) {
  const router = Router();

  router.get("/", validate({ query: VaultQuery }), async (req, res) => {
    const { address } = req.query as z.infer<typeof VaultQuery>;
    const [vault, position] = await onLedger(() =>
      Promise.all([ledger.getVault(), address ? ledger.getPosition(address) : undefined]),
    );
    const body: VaultView = { ...vault, ...(position ? { position } : {}) };
    res.json(body);
  });

  // The backend signs for the depositor in this demo, so only demo wallets can move funds.
  const move = (kind: "deposit" | "withdraw") =>
    router.post(`/${kind}`, validate({ body: MoveFunds }), async (req, res) => {
      const { address, amount } = req.body as MoveFunds;
      if (!ledger.getWallets().some((w) => w.address === address)) {
        throw new HttpError(400, "Unknown wallet", { fields: { address: "must be one of the demo wallets from GET /api/wallets" } });
      }
      // Deposits only in the deposit window; withdrawals in the window or after redemption. A wrong phase is a 409 with opensAt.
      const tx = await onLedger(() => (kind === "deposit" ? ledger.deposit(address, amount) : ledger.withdraw(address, amount)));
      audit(db, { actor: "depositor", action: kind === "deposit" ? "vault_deposit" : "vault_withdraw", tx, note: `${amount} by ${address}` });
      res.json(tx);
    });
  move("deposit");
  move("withdraw");

  return router;
}
