import type { VaultView } from "@hack/shared";
import { Countdown } from "./Countdown";

/** "Oct 25, 12:34 PM": short enough for a timeline cell. A bad date prints a dash. */
export function when(iso: string | null | undefined) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

const STEPS = [
  { phase: "subscription", label: "Deposit window", does: "Lenders deposit" },
  { phase: "investment", label: "Lending", does: "Loans are made" },
  { phase: "redemption", label: "Withdrawals", does: "Lenders withdraw" },
] as const;

/** The vault's three phases on one track, so every enabled or disabled button has its reason in view. */
export function VaultTimeline({ vault }: { vault: VaultView }) {
  const now = STEPS.findIndex((s) => s.phase === vault.phase);
  const ends = [vault.subscriptionDate, vault.redemptionDate, null];
  const span = [`Until ${when(vault.subscriptionDate)}`, `Until ${when(vault.redemptionDate)}`, `From ${when(vault.redemptionDate)}`];
  return (
    <ol className="vault-timeline" aria-label="Vault timeline">
      {STEPS.map((s, i) => {
        const state = i < now ? "done" : i === now ? "now" : "next";
        return (
          <li key={s.phase} className={`vt-step vt-step--${state}`} aria-current={state === "now" ? "step" : undefined}>
            <span className="vt-bar" aria-hidden="true" />
            <b>{s.label}{state === "now" ? <span className="vt-now">Now</span> : null}</b>
            <small>
              {state === "now" && ends[i] ? <>{s.does} · ends in <Countdown to={ends[i]} /></> : state === "now" ? `${s.does} · open` : span[i]}
            </small>
          </li>
        );
      })}
    </ol>
  );
}

/** One sentence for the page header: what the vault allows right now. */
export function PhaseSentence({ vault }: { vault: VaultView }) {
  if (vault.phase === "subscription") return <>Deposits are open for <Countdown to={vault.subscriptionDate} />. Loans start when the window closes.</>;
  if (vault.phase === "investment") return <>The vault is lending. Withdrawals open in <Countdown to={vault.redemptionDate} />.</>;
  return <>Withdrawals are open. New deposits wait for the next vault.</>;
}
