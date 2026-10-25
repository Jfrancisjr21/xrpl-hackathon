import {
  AmountInput, ApplicationView, Decision, DemoWallet, LoanApplicationInput, LoanView, VaultView, estimateLoan,
  type ApplicationStatus, type HealthResponse, type TxResult, type VaultPhase,
} from "@hack/shared";
import { ApiError } from "../lib/apiError";
import walletsJson from "./demo-wallets.json"; // not wallets.json: the repo gitignores that name (real seeds)
import vaultJson from "./vault.json";
import approvedJson from "./application-approved.json";
import deniedJson from "./application-denied.json";
import carolJson from "./decision-carol.json";
import blockedJson from "./decision-blocked.json";
import loanJson from "./loan.json";

// Sample data served by lib/api.ts when VITE_MOCK=true, until the API routes merge; then delete this folder.
// JSON widens "investment" to string, so `satisfies` can't type it: each file goes through its contract schema
// instead, which types it and throws at load if a sample drifts from the contract.
// Addresses are made up in the XRPL format; the real ones come from apps/api/wallets.json.

const wallets = DemoWallet.array().parse(walletsJson);
const vault = VaultView.parse(vaultJson); // a fresh vault, as `pnpm ledger:new-vault` leaves it
const applicationApproved = ApplicationView.parse(approvedJson);
const applicationDenied = ApplicationView.parse(deniedJson);
const loan = LoanView.parse(loanJson);

// shortcut: a tiny stand-in for the vault routes so the depositor flow can be clicked through before the API
// merges. It follows the server's timeline (.env.example): deposits for VAULT_SUBSCRIPTION_SEC after the vault
// opens (here: page load), lending for VAULT_TERM_SEC, then redemption. VITE_MOCK_SUBSCRIPTION_SEC and
// VITE_MOCK_TERM_SEC shorten both to test every phase. Delete it with this folder once the vault routes exist.
const opened = Date.now();
const subscriptionSec = Number(import.meta.env.VITE_MOCK_SUBSCRIPTION_SEC ?? 300);
const termSec = Number(import.meta.env.VITE_MOCK_TERM_SEC ?? 7200);
const subscriptionDate = new Date(opened + subscriptionSec * 1000).toISOString();
const redemptionDate = new Date(opened + (subscriptionSec + termSec) * 1000).toISOString();
const confirmMs = import.meta.env.MODE === "test" ? 0 : 1500; // a Devnet write takes a few seconds

const phaseAt = (now = Date.now()): VaultPhase =>
  now < Date.parse(subscriptionDate) ? "subscription" : now < Date.parse(redemptionDate) ? "investment" : "redemption";

// The vault asset (a Devnet test MPT shown as simulated XRP) is an MPT, so amounts are whole numbers and plain integers are exact here.
const deposits = new Map<string, number>(vault.position ? [[vault.position.address, Number(vault.position.deposited)]] : []);
const others = Number(vault.assetsTotal) - [...deposits.values()].reduce((a, b) => a + b, 0);
const total = () => others + [...deposits.values()].reduce((a, b) => a + b, 0);
// Loans the simulated broker originated (below). What is lent out is their outstanding principal.
const loans: LoanView[] = [];
const isOpenLoan = (l: LoanView) => l.status === "active" || l.status === "impaired";
const lent = () => loans.filter(isOpenLoan).reduce((sum, l) => sum + Number(l.principal), 0);

const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
// No timer at all when the delay is zero (tests), so fake timers never hold a write.
const settle = () => (confirmMs ? new Promise((r) => setTimeout(r, confirmMs)) : Promise.resolve());
const confirmed = async (): Promise<TxResult> => {
  await settle();
  const hash = hex();
  return { hash, result: "tesSUCCESS", explorerUrl: `https://devnet.xrpl.org/transactions/${hash}` };
};

function vaultFor(address?: string): VaultView {
  const { position: _, ...rest } = vault;
  const t = total();
  const l = lent();
  const view: VaultView = {
    ...rest,
    assetsTotal: String(t),
    assetsAvailable: String(t - l),
    utilizationPct: t ? (l / t) * 100 : 0,
    phase: phaseAt(),
    subscriptionDate,
    redemptionDate,
  };
  if (!address) return view;
  const d = deposits.get(address) ?? 0;
  return { ...view, position: { address, deposited: String(d), sharePct: t ? (d / t) * 100 : 0 } };
}

/** POST /api/vault/deposit: only in the deposit window (the ledger answers tecEXPIRED after it). */
async function deposit(address: string, amount: string): Promise<TxResult> {
  const n = Number(AmountInput.parse(amount));
  const tx = await confirmed();
  if (phaseAt() !== "subscription") throw new Error("Deposits are closed: the deposit window has ended.");
  deposits.set(address, (deposits.get(address) ?? 0) + n);
  return tx;
}

/** POST /api/vault/withdraw: only in redemption (the ledger answers tecTOO_SOON before it), and at most your position. */
async function withdraw(address: string, amount: string): Promise<TxResult> {
  const n = Number(AmountInput.parse(amount));
  const tx = await confirmed();
  if (phaseAt() !== "redemption") throw new Error("Withdrawals open at the redemption date.");
  const d = deposits.get(address) ?? 0;
  if (n > d) throw new Error(`You can withdraw at most ${d} ${vault.assetLabel}.`);
  deposits.set(address, d - n);
  return tx;
}

// shortcut: a stand-in for the application routes, for the same reason. Each demo borrower gets their persona's
// decision (Alice approved at 7.4%, Carol at 12.8%, Bob denied, Mallory blocked by sanctions). The broker's approval
// is simulated VITE_MOCK_BROKER_SEC (default 20) after applying, so the whole timeline can be watched.
const decisions: Partial<Record<DemoWallet["role"], Decision>> = {
  alice: applicationApproved.decision,
  carol: Decision.parse(carolJson),
  bob: applicationDenied.decision,
  borrower: Decision.parse(blockedJson),
};
const brokerSec = Number(import.meta.env.VITE_MOCK_BROKER_SEC ?? 20);
const OPEN: ApplicationStatus[] = ["pending_review", "originating", "active"];
const applications: ApplicationView[] = [];

const update = (app: ApplicationView, status: ApplicationStatus, extra: Partial<ApplicationView> = {}) =>
  Object.assign(app, { status, updatedAt: new Date().toISOString(), ...extra });

/** The broker approves after brokerSec; the two-signature LoanSet then takes a few seconds and the loan exists. */
function simulateBrokerApproval(app: ApplicationView) {
  setTimeout(() => {
    update(app, "originating");
    setTimeout(async () => {
      const tx = await confirmed();
      const loanId = hex();
      originate(app, loanId);
      update(app, "active", { loanId, tx });
    }, 3000);
  }, brokerSec * 1000);
}

// shortcut: a stand-in for the loan routes, same reason. Payments come every intervalSec (60 s, DEMO_FAST_LOANS);
// a loan is late once its due date passes, can be defaulted after GRACE_SEC, and the simulated broker impairs it
// brokerSec after it falls behind. Amounts are display strings with two decimals; the real ledger computes them.
const intervalSec = 60;
const GRACE_SEC = 60; // the ledger's default grace period
const terms = new Map<string, { total: number; principal: number; repaid: number }>();
const iso = (ms: number) => new Date(ms).toISOString();

function originate(app: ApplicationView, loanId: string) {
  const est = estimateLoan({ principal: app.amount, interestRate: app.decision.interestRate ?? 0, paymentTotal: app.paymentTotal, paymentIntervalSec: intervalSec });
  terms.set(loanId, { total: app.paymentTotal, principal: Number(app.amount), repaid: Number(est.totalRepaid) });
  loans.push({
    loanId, applicationId: app.id, borrower: app.borrowerAddress, principal: app.amount,
    interestRate: app.decision.interestRate ?? 0, paymentsRemaining: app.paymentTotal,
    nextDueIso: iso(Date.now() + intervalSec * 1000), totalOwed: est.totalRepaid, status: "active",
    installmentDue: est.periodicPayment, payoffAmount: app.amount, canImpair: false, canDefault: false,
  });
}

/** Brings a loan's late flags up to now, and lets the simulated broker impair it once it has been late a while. */
function age(l: LoanView, now = Date.now()) {
  if (!isOpenLoan(l) || !l.nextDueIso) return;
  const due = Date.parse(l.nextDueIso);
  if (l.status === "active" && now > due + brokerSec * 1000) l.status = "impaired";
  l.canImpair = l.status === "active" && now > due;
  l.canDefault = now > due + GRACE_SEC * 1000;
}

function close(l: LoanView) {
  Object.assign(l, {
    status: "paid", principal: "0", paymentsRemaining: 0, nextDueIso: null, totalOwed: null,
    installmentDue: null, payoffAmount: null, canImpair: false, canDefault: false,
  });
}

/** POST /api/loans/:id/pay-due (one installment) and /pay { mode }. The ledger decides the amount (R3). */
async function payLoan(loanId: string, mode: "installment" | "payoff"): Promise<{ tx: TxResult; amount: string }> {
  const l = loans.find((x) => x.loanId === loanId);
  if (!l) throw new ApiError(`Loan ${loanId} not found.`, 404);
  age(l);
  if (!isOpenLoan(l)) throw new ApiError("This loan is no longer open.", 409);
  const tx = await confirmed();
  if (mode === "payoff") {
    const amount = l.payoffAmount!;
    close(l);
    return { tx, amount };
  }
  const t = terms.get(loanId)!;
  const amount = l.installmentDue!;
  const left = l.paymentsRemaining! - 1;
  if (left === 0) { close(l); return { tx, amount }; }
  const nextDue = Date.parse(l.nextDueIso!) + intervalSec * 1000;
  Object.assign(l, {
    paymentsRemaining: left, nextDueIso: iso(nextDue),
    principal: ((t.principal * left) / t.total).toFixed(2), payoffAmount: ((t.principal * left) / t.total).toFixed(2),
    // From the total repaid, not installment × left, so cents rounding never puts it below the principal.
    totalOwed: ((t.repaid * left) / t.total).toFixed(2),
    // Back on schedule: the simulated broker lifts the impairment.
    status: l.status === "impaired" && nextDue > Date.now() ? "active" : l.status,
  });
  age(l);
  return { tx, amount };
}

/** POST /api/applications: scored at once; 409 during the deposit window (with opensAt) or while one is open (R11). */
async function apply(body: LoanApplicationInput): Promise<ApplicationView> {
  const input = LoanApplicationInput.safeParse(body);
  if (!input.success) throw new ApiError("Check the amount and the number of payments.", 400);
  await settle();
  if (phaseAt() === "subscription") throw new ApiError("Loans open when the deposit window closes.", 409, subscriptionDate);
  const { borrowerAddress, amount, paymentTotal } = input.data;
  // Open: still in review or being created, or active with a loan that isn't paid off or defaulted yet.
  const stillOpen = (a: ApplicationView) =>
    OPEN.includes(a.status) && (a.status !== "active" || loans.some((l) => l.loanId === a.loanId && isOpenLoan(l)));
  if (applications.some((a) => a.borrowerAddress === borrowerAddress && stillOpen(a))) {
    throw new ApiError("You already have an open application.", 409);
  }
  const role = wallets.find((w) => w.address === borrowerAddress)?.role;
  const decision = role && decisions[role];
  if (!decision) throw new ApiError("Only the four demo borrowers can apply in mock mode.", 400);
  const now = new Date().toISOString();
  const app: ApplicationView = {
    id: applications.length + 1, borrowerAddress, amount, paymentTotal,
    status: decision.approved ? "pending_review" : "denied",
    decision, decisionHash: hex().toLowerCase(), createdAt: now, updatedAt: now,
  };
  applications.push(app);
  if (decision.approved) simulateBrokerApproval(app);
  return structuredClone(app);
}

// shortcut: a stand-in for GET /api/verify/:address (Feature 5) until Ralph's route and contract types merge.
// Only Alice holds a score passport; every other wallet is not verified.
export type VerifyResult =
  | { address: string; verified: true; token: { score: number; level: "A" | "B" | "C"; issuedAt: string; kyc: boolean; credit: boolean; lending: boolean; txUrl?: string } }
  | { address: string; verified: false; reason: "no_token" };

function verify(address: string): VerifyResult {
  const role = wallets.find((w) => w.address === address)?.role;
  return role === "alice"
    ? { address, verified: true, token: { score: 88, level: "A", issuedAt: iso(opened), kyc: true, credit: true, lending: true } }
    : { address, verified: false, reason: "no_token" };
}

export const samples = {
  health: (): HealthResponse => ({ ok: true, mockMode: true, network: "devnet", vaultPhase: phaseAt() }),
  verify,
  wallets,
  vault,
  applicationApproved,
  applicationDenied,
  decisions,
  loan,
  /** As GET /api/vault?address= answers: the position only when an address is given, zero for one that never deposited. */
  vaultFor,
  deposit,
  withdraw,
  apply,
  /** GET /api/applications/:id */
  application: async (id: number) => {
    const app = applications.find((a) => a.id === id);
    if (!app) throw new ApiError(`Application ${id} not found.`, 404);
    return structuredClone(app);
  },
  /** GET /api/applications?borrower=, newest first. */
  applicationsFor: (borrower: string) =>
    structuredClone(applications.filter((a) => a.borrowerAddress === borrower).sort((a, b) => b.id - a.id)),
  /** GET /api/loans?borrower= */
  loansFor: (borrower?: string) => {
    loans.forEach((l) => age(l));
    return structuredClone(loans.filter((l) => !borrower || l.borrower === borrower));
  },
  payDue: (loanId: string) => payLoan(loanId, "installment"),
  pay: (loanId: string, mode: "installment" | "payoff") => payLoan(loanId, mode),
  timeline: { opened, subscriptionDate, redemptionDate },
};
