import type {
  AgentDelegation, AgentPolicy, AgentView, Alert, ApplicationStatus, ApplicationView, AuditEvent, BrokerView,
  DemoWallet, HealthResponse, LoanApplicationInput, LoanView, PayMode, PayResult, RevenueView, TxResult, VaultView,
} from "@hack/shared";
import { samples } from "../samples";

// The only file that calls fetch. Shapes come from the contract in @hack/shared.

const BASE = import.meta.env.VITE_API_URL ?? ""; // empty in dev: Vite proxies /api to :3001

// VITE_MOCK=true serves the reads from samples/ until the API routes merge. Writes always go to the API.
const MOCK = import.meta.env.VITE_MOCK === "true";

export class ApiError extends Error {
  status: number;
  opensAt: string | null;
  constructor(message: string, status: number, opensAt: string | null = null) {
    super(message);
    this.status = status;
    this.opensAt = opensAt;
  }
}

let brokerKey: string | null = null;
export const setBrokerKey = (k: string | null) => { brokerKey = k; };

async function http<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(brokerKey ? { "x-broker-key": brokerKey } : {}), ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status, body.opensAt ?? null);
  return body as T;
}
const post = <T,>(path: string, body: unknown = {}) => http<T>(path, { method: "POST", body: JSON.stringify(body) });
const read = <T,>(path: string, sample: () => T) => (MOCK ? Promise.resolve(sample()) : http<T>(path));
const q = (s: string | number) => encodeURIComponent(s);

export const api = {
  health: () => read<HealthResponse>("/health", () => samples.health),
  wallets: () => read<DemoWallet[]>("/wallets", () => samples.wallets),
  vault: (address?: string) => read<VaultView>("/vault" + (address ? `?address=${q(address)}` : ""), () => samples.vault),
  deposit: (address: string, amount: string) => post<TxResult>("/vault/deposit", { address, amount }),
  withdraw: (address: string, amount: string) => post<TxResult>("/vault/withdraw", { address, amount }),
  apply: (body: LoanApplicationInput) => post<ApplicationView>("/applications", body),
  application: (id: number) => read<ApplicationView>(`/applications/${q(id)}`, () => samples.applicationApproved),
  myApplications: (borrower: string) =>
    read<ApplicationView[]>(`/applications?borrower=${q(borrower)}`, () => samples.applicationsFor(borrower)),
  loans: (borrower?: string) =>
    read<LoanView[]>("/loans" + (borrower ? `?borrower=${q(borrower)}` : ""), () => samples.loansFor(borrower)),
  pay: (loanId: string, mode: PayMode) => post<PayResult>(`/loans/${q(loanId)}/pay`, { mode }),
  payDue: (loanId: string) => post<PayResult>(`/loans/${q(loanId)}/pay-due`),
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
  setPolicy: (policy: AgentPolicy) => post<AgentView>("/agent/policy", policy),
  setDelegation: (body: AgentDelegation) => post<TxResult | null>("/agent/delegation", body),
  alerts: () => http<Alert[]>("/alerts"),
};
