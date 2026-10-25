import { useState } from "react";
import type { ApplicationView } from "@hack/shared";
import { api } from "../../lib/api";
import { useTx } from "../../lib/hooks";
import { isAmount } from "../../lib/format";
import { Countdown } from "../../components/Countdown";
import { ErrorBanner } from "../../components/ErrorBanner";

const PAYMENTS = [3, 6, 12];

/** Amount and number of payments. The server sets the payment interval (60 seconds in the demo). */
export function ApplyForm({ address, assetLabel, loansOpenAt, onApplied }: {
  address: string;
  assetLabel: string;
  /** Set while the vault is still in its deposit window: loans open at this time. */
  loansOpenAt: string | null;
  onApplied: () => Promise<void>;
}) {
  const tx = useTx<ApplicationView>();
  const [value, setValue] = useState("");
  // 3 fits every approval level (level C and secured offers allow at most 3 payments).
  const [paymentTotal, setPaymentTotal] = useState(3);
  // FCRA permissible purpose: no consent, no credit pull, so the agent cannot assess the application.
  const [creditConsent, setCreditConsent] = useState(false);
  const invalid = value !== "" && !isAmount(value);
  const opensAt = loansOpenAt ?? tx.opensAt;
  // R11: a 409 without opensAt means an application is already open; the screen shows it below.
  const alreadyOpen = tx.status === 409 && !tx.opensAt;

  const submit = () => tx.run(() => api.apply({ borrowerAddress: address, amount: value, paymentTotal, creditConsent }), async () => { setValue(""); await onApplied(); });

  return (
    <section className="card apply" aria-label="Apply for a loan">
      <h2>Apply for a loan</h2>
      <label className="field">
        <span>Amount</span>
        <span className="field-input">
          <input
            inputMode="numeric" autoComplete="off" placeholder="500" value={value} disabled={tx.pending}
            aria-invalid={invalid} aria-describedby="apply-help"
            onChange={(e) => setValue(e.target.value.trim())}
          />
          <small>{assetLabel}</small>
        </span>
      </label>
      <p id="apply-help" className={invalid ? "help help--error" : "help"}>
        {invalid ? `Enter a whole number of ${assetLabel}, like 500.` : `Whole ${assetLabel} only.`}
      </p>
      <fieldset className="segment" disabled={tx.pending}>
        <legend>Number of payments</legend>
        {PAYMENTS.map((n) => (
          <label key={n} className={n === paymentTotal ? "segment-option is-on" : "segment-option"}>
            <input type="radio" name={`payments-${address}`} value={n} checked={n === paymentTotal} onChange={() => setPaymentTotal(n)} />
            {n}
          </label>
        ))}
      </fieldset>
      <p className="hint">Demo loans use 60-second payments so you can watch the whole lifecycle. Lower scores allow fewer payments.</p>
      <label className="consent">
        <input type="checkbox" checked={creditConsent} disabled={tx.pending} onChange={(e) => setCreditConsent(e.target.checked)} />
        <span>I authorize a soft credit check. It does not affect my credit score.</span>
      </label>
      <div className="move-actions">
        <button type="button" className="button button--primary" disabled={!isAmount(value) || !creditConsent || tx.pending || !!loansOpenAt} onClick={submit}>
          {tx.pending ? "Scoring…" : "Apply"}
        </button>
      </div>
      {opensAt && <p className="notice">Loans open when the deposit window closes, in <Countdown to={opensAt} />.</p>}
      {alreadyOpen && <p className="notice">You already have an open application; it's shown below.</p>}
      {!opensAt && !alreadyOpen && <ErrorBanner error={tx.error} />}
    </section>
  );
}
