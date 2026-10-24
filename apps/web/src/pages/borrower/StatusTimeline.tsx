import type { ApplicationView } from "@hack/shared";
import { STEPS, timelineOf } from "./status";

/** Submitted → Scored by agent → Broker review → Creating loan on Devnet → Loan active, with a red end state. */
export function StatusTimeline({ app }: { app: ApplicationView }) {
  const { states, note } = timelineOf(app);
  return (
    <div className="timeline-wrap">
      <ol className="timeline" aria-label="Application progress">
        {STEPS.map((step, i) => (
          <li key={step} className={`step step--${states[i]}`} aria-current={states[i] === "current" ? "step" : undefined}>
            <span className="step-dot" aria-hidden="true" />
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {note && <p className="timeline-note" role="status">{note}</p>}
    </div>
  );
}
