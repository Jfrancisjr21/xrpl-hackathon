import type {
  AgentDelegation, AgentPolicy, AgentView, ApplicationStatus, ApplicationView, AuditEvent, BrokerView, DecisionReceipt,
  DemoWallet, HealthResponse, LoanApplicationInput, LoanView, PayMode, PayResult, RevenueView, TxResult, VaultView,
  VerifyResult,
} from "@hack/shared";
import { samples } from "../samples";
import { ApiError } from "./apiError";

// The only file that calls fetch. Shapes come from the contract in @hack/shared.

const BASE = import.meta.env.VITE_API_URL ?? ""; // empty in dev: Vite proxies /api to :3001

// VITE_MOCK=true serves the reads, the vault deposit and withdraw, loan applications and loan payments from samples/
// until the API routes merge. Every other write always goes to the API.
const MOCK = import.meta.env.VITE_MOCK === "true";

export { ApiError };

let brokerKey: string | null = null;
export const setBrokerKey = (k: string | null) => { brokerKey = k; };

async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(brokerKey ? { "x-broker-key": brokerKey } : {}), ...init.headers },
    });
  } catch {
    // fetch only throws when the server can't be reached at all; the browser's own wording means nothing to a user.
    throw new ApiError("Can't reach the lending API. Check that it is running, then retry.", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status, body.opensAt ?? null);
  return body as T;
}
const post = <T,>(path: string, body: unknown = {}) => http<T>(path, { method: "POST", body: JSON.stringify(body) });
const read = <T,>(path: string, sample: () => T) => (MOCK ? Promise.resolve(sample()) : http<T>(path));
const q = (s: string | number) => encodeURIComponent(s);

export const api = {
  health: () => read<HealthResponse>("/health", samples.health),
  wallets: () => read<DemoWallet[]>("/wallets", () => samples.wallets),
  vault: (address?: string) => read<VaultView>("/vault" + (address ? `?address=${q(address)}` : ""), () => samples.vaultFor(address)),
  deposit: (address: string, amount: string) =>
    MOCK ? samples.deposit(address, amount) : post<TxResult>("/vault/deposit", { address, amount }),
  withdraw: (address: string, amount: string) =>
    MOCK ? samples.withdraw(address, amount) : post<TxResult>("/vault/withdraw", { address, amount }),
  apply: (body: LoanApplicationInput) => (MOCK ? samples.apply(body) : post<ApplicationView>("/applications", body)),
  application: (id: number) => (MOCK ? samples.application(id) : http<ApplicationView>(`/applications/${q(id)}`)),
  receipt: (id: number) => http<DecisionReceipt>(`/applications/${q(id)}/receipt`), // Feature 1: hash and ledger memo check
  myApplications: (borrower: string) =>
    read<ApplicationView[]>(`/applications?borrower=${q(borrower)}`, () => samples.applicationsFor(borrower)),
  loans: (borrower?: string) =>
    read<LoanView[]>("/loans" + (borrower ? `?borrower=${q(borrower)}` : ""), () => samples.loansFor(borrower)),
  pay: (loanId: string, mode: PayMode) => (MOCK ? samples.pay(loanId, mode) : post<PayResult>(`/loans/${q(loanId)}/pay`, { mode })),
  payDue: (loanId: string) => (MOCK ? samples.payDue(loanId) : post<PayResult>(`/loans/${q(loanId)}/pay-due`)),
  // Broker (page 04)
  broker: () => http<BrokerView>("/broker"),
  coverDeposit: (amount: string) => post<TxResult>("/broker/cover/deposit", { amount }),
  coverWithdraw: (amount: string) => post<TxResult>("/broker/cover/withdraw", { amount }),
  revenue: () => http<RevenueView>("/broker/revenue"),
  audit: () => http<AuditEvent[]>("/broker/audit"),
  applications: (status?: ApplicationStatus) => http<ApplicationView[]>("/applications" + (status ? `?status=${q(status)}` : "")),
  approve: (id: number) => post<ApplicationView>(`/applications/${q(id)}/approve`),
  reject: (id: number, note: string) => post<ApplicationView>(`/applications/${q(id)}/reject`, { note }),
  manageLoan: (loanId: string, action: "impair" | "unimpair" | "default" | "delete") => post<TxResult>(`/loans/${q(loanId)}/${action}`),
  agent: () => http<AgentView>("/agent"),
  setAgentRunning: (running: boolean) => post<AgentView>(`/agent/${running ? "resume" : "pause"}`),
  setPolicy: (policy: AgentPolicy) => post<AgentView>("/agent/policy", policy),
  setDelegation: (body: AgentDelegation) => post<TxResult | null>("/agent/delegation", body),
  // Feature 5: public score-passport check, no key needed
  verify: (address: string) => read<VerifyResult>(`/verify/${q(address)}`, () => samples.verify(address)),
};
