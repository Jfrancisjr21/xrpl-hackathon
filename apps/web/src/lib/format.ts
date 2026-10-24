import { AmountInput } from "@hack/shared";

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
export const amount = (s: string | null | undefined) => Number(s ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
/** Rates are tenths of a basis point: 7400 = 7.4%. */
export const pct = (tenthsBp: number) => `${(tenthsBp / 1000).toFixed(1)}%`;

/** R15: dates are ISO, but never crash on a bad one. */
export function date(iso: string | null | undefined) {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "—";
}

/** Whole seconds until iso (negative once passed), or null for a missing or bad date. */
export function secondsUntil(iso: string | null | undefined, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : Math.round((t - now) / 1000);
}

/** What a user may send: a whole number of TSTUSD, as the contract's AmountInput requires (MPT amounts are integers). */
export const isAmount = (s: string) => AmountInput.safeParse(s).success;
