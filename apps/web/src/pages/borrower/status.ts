import type { ApplicationStatus, ApplicationView, Decision } from "@hack/shared";

/** Blocked when the sanctions gate stopped it before scoring; a secured credit-builder offer; otherwise the agent's yes or no. */
export function verdictOf(d: Decision): "Approved" | "Denied" | "Blocked" | "Secured offer" {
  if (d.sanctions.blocked) return "Blocked";
  if (d.outcome === "secured_offer") return "Secured offer";
  return d.approved ? "Approved" : "Denied";
}

/** A new application is allowed once the last one has ended without a loan. */
export const ENDED: ApplicationStatus[] = ["denied", "rejected", "failed"];
export const WAITING: ApplicationStatus[] = ["pending_review", "originating"];

export const STEPS = ["Submitted", "Scored by agent", "Broker review", "Creating loan on Devnet", "Loan active"] as const;
export type StepState = "done" | "current" | "failed" | "todo";

/** Each step's state for one application; a failed step is where it stopped, with the reason to show beside it. */
export function timelineOf(app: ApplicationView): { states: StepState[]; note: string | null } {
  const at: Record<ApplicationStatus, [number, StepState]> = {
    denied: [1, "failed"],
    pending_review: [2, "current"],
    rejected: [2, "failed"],
    originating: [3, "current"],
    failed: [3, "failed"],
    active: [4, "done"],
  };
  const [step, state] = at[app.status];
  const states = STEPS.map((_, i): StepState => (i < step ? "done" : i === step ? state : "todo"));
  const note =
    app.status === "denied"
      ? app.decision.sanctions.blocked ? "Blocked by the sanctions check."
      : app.decision.outcome === "secured_offer" ? "Offered a secured credit-builder loan instead of an unsecured one."
      : "Denied by the agent."
    : app.status === "rejected" ? `Declined by the broker${app.brokerNote ? `: ${app.brokerNote}` : "."}`
    : app.status === "failed" ? `The loan could not be created${app.error ? `: ${app.error}` : "."}`
    : null;
  return { states, note };
}

/** The application that matters: the newest one (highest id). */
export const latestOf = (apps: ApplicationView[] | null) =>
  (apps ?? []).reduce<ApplicationView | null>((latest, a) => (!latest || a.id > latest.id ? a : latest), null);
