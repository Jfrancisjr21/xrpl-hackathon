import type { LedgerService } from "@hack/ledger";
import { evaluate } from "@hack/risk";
import type { Decision, LoanApplicationInput } from "@hack/shared";
import type { PullCredit } from "./credit";

// What the API knows from its own database: the ban list and the borrower's history with us.
export interface UnderwriteContext {
  banned: boolean; // defaulted on a loan with us
  loansPaidOff: number; // feeds the internal score
  minScore: number; // the broker's pass mark (POST /api/agent/policy)
}

// Turns an application into the agent's Decision. Routes depend on this signature, not on @hack/risk directly.
export type Underwrite = (input: LoanApplicationInput, ctx: UnderwriteContext) => Promise<Decision>;

// The real underwriting agent: @hack/risk evaluate() fed with ledger facts, a credit pull and the vault's capacity.
export function riskUnderwrite(ledger: LedgerService, pullCredit: PullCredit): Underwrite {
  return async (input, ctx) => {
    // R17: the borrower role is Mallory on every laptop, so her sanctions entry is built from the live wallet list.
    const mallory = ledger.getWallets().find((w) => w.role === "borrower")?.address;
    const [vault, broker] = await Promise.all([ledger.getVault(), ledger.getBroker()]);
    return evaluate(input, {
      banned: ctx.banned,
      history: { loansPaidOff: ctx.loansPaidOff },
      policy: { minScore: ctx.minScore },
      sanctionsExtra: mallory ? { [mallory]: "Sanctions demo (borrower role)" } : {},
      capacity: {
        assetsAvailable: vault.assetsAvailable,
        debtTotal: broker.debtTotal,
        coverAvailable: broker.coverAvailable,
        coverRateMinimum: broker.coverRateMinimum,
      },
      getFacts: (address) => ledger.getAccountFacts(address),
      pullCredit,
    });
  };
}
