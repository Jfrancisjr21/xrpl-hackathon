import type { VaultView } from "@hack/shared";
import { Countdown } from "./Countdown";

/** The vault phase explains every enabled and disabled button on the user screens. */
export function PhaseBanner({ vault }: { vault: VaultView }) {
  if (vault.phase === "subscription") {
    return <div className="phase phase--open">Deposit window open, closes in <Countdown to={vault.subscriptionDate} />. Loans start after that.</div>;
  }
  if (vault.phase === "investment") {
    return <div className="phase">The vault is lending. Deposits are closed; withdrawals open in <Countdown to={vault.redemptionDate} />.</div>;
  }
  return <div className="phase phase--open">Redemption phase: depositors can withdraw.</div>;
}
