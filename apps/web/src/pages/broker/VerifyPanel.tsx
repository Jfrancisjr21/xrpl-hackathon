import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { DemoWallet, VerifyResult } from "@hack/shared";
import { StatusBadge } from "../../components/StatusBadge";
import { api } from "../../lib/api";
import { samples } from "../../samples";
import { formatDate } from "./model";

/** The internal score's unit, shown next to every score (for example "88 LCS"). */
export const SCORE_UNIT = "LCS";

const check = (ok: boolean, label: string) => <StatusBadge value={ok ? "clear" : "review"} label={`${label}: ${ok ? "passed" : "not recorded"}`} />;

export function sampleVerification(address: string, wallets: DemoWallet[]): VerifyResult {
  const role = wallets.find((wallet) => wallet.address === address)?.role;
  const sampleAddress = samples.wallets.find((wallet) => wallet.role === role)?.address ?? address;
  const result = samples.verify(sampleAddress);
  return result.token ? { ...result, address, token: { ...result.token, holder: address } } : { ...result, address };
}

/** What another lender sees when they check a wallet's score passport. */
export function VerifyPanel({ preview = false }: { preview?: boolean }) {
  const [wallets, setWallets] = useState<DemoWallet[]>(samples.wallets);
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.wallets().then(setWallets).catch(() => {}); }, []);
  const picks = ["alice", "borrower"].flatMap((role) => wallets.filter((wallet) => wallet.role === role));

  async function verify(target: string) {
    setAddress(target);
    setPending(true);
    setError(null);
    setResult(null);
    try {
      setResult(preview ? sampleVerification(target, wallets) : await api.verify(target));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  const submit = (event: FormEvent) => { event.preventDefault(); if (address.trim()) void verify(address.trim()); };

  return (
    <div className="verify-panel">
      <form onSubmit={submit}>
        <label htmlFor="verify-address">Wallet address</label>
        <input id="verify-address" name="wallet-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="r…" autoComplete="off" spellCheck={false} disabled={pending} />
        <button className="button button--primary button--small" type="submit" disabled={pending || !address.trim()}>{pending ? "Checking the ledger…" : "Verify"}</button>
      </form>
      <p className="panel-note">
        Try:{" "}
        {picks.map((w) => (
          <button key={w.address} className="text-button" type="button" disabled={pending} onClick={() => void verify(w.address)}>{w.label}</button>
        ))}
      </p>
      {error ? <div className="alert-error" role="alert">{error}</div> : null}
      {result?.verified && result.token ? (
        <div role="status">
          <p><StatusBadge value="clear" label="Verified" /> <strong className="num">{result.token.score} {SCORE_UNIT}</strong> · Level {result.token.level} · issued {formatDate(result.token.issuedAt)}</p>
          <p>{check(result.token.kyc, "KYC")} {check(result.token.credit, "Credit")} {check(result.token.lending, "Lending")}</p>
          <p className="panel-note">Valid until {formatDate(result.token.expiresAt)} · held by <span className="mono">{result.token.holder}</span></p>
          {result.token.txUrl ? <a href={result.token.txUrl} target="_blank" rel="noreferrer">Open the passport on XRPL Explorer</a> : null}
        </div>
      ) : result ? (
        <p role="status"><StatusBadge value="denied" label="Not verified" /> {result.reason === "expired" ? `This score passport expired${result.token ? ` on ${formatDate(result.token.expiresAt)}` : ""}.` : "No score passport from us for this wallet."}</p>
      ) : null}
      {preview && result ? <p className="panel-note">Preview data. No ledger request was made.</p> : null}
    </div>
  );
}
