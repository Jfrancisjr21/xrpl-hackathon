import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Loads now and every intervalMs (0 = once). Keeps the last good data while a refresh fails (R6). */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], intervalMs = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadRef = useRef(load);
  // Declared before the polling effect, so the newest load is in place before it runs.
  useEffect(() => { loadRef.current = load; });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { setData(await loadRef.current()); setError(null); }
    catch (e) { setError(errorText(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh();
    if (!intervalMs) return;
    const t = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(t);
  }, [...deps, intervalMs]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading, refreshing, refresh };
}

/**
 * One write at a time per button. Keeps the last result and error for the receipt or the error line.
 * A new attempt clears both, so an earlier receipt never sits next to a failure it does not belong to.
 */
export function useTx<R>() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opensAt, setOpensAt] = useState<string | null>(null);
  const run = async (fn: () => Promise<R>, after?: () => unknown) => {
    setPending(true); setResult(null); setError(null); setOpensAt(null);
    try { const r = await fn(); setResult(r); await after?.(); return r; }
    catch (e) { setError(errorText(e)); if (e instanceof ApiError) setOpensAt(e.opensAt); return null; }
    finally { setPending(false); }
  };
  return { pending, result, error, opensAt, run };
}
