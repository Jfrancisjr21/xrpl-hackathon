import type { VaultView } from "@hack/shared";
import { secondsUntil } from "../../lib/format";

/**
 * Why each form is closed right now, or null when it is open. The vault is closed-ended: deposits only in the
 * subscription window, withdrawals only in redemption. The deposit window is also checked against the clock, so
 * the form closes the moment the countdown hits zero rather than at the next poll.
 */
export function depositorLocks(v: VaultView, now = Date.now()): { deposit: string | null; withdraw: string | null } {
  const windowLeft = secondsUntil(v.subscriptionDate, now);
  const depositOpen = v.phase === "subscription" && (windowLeft === null || windowLeft > 0);
  return {
    deposit: depositOpen ? null
      : v.phase === "subscription" ? "The deposit window has just closed."
      : `Deposits are closed in the ${v.phase} phase.`,
    withdraw: v.phase === "redemption" ? null : "Withdrawals open at the redemption date.",
  };
}
