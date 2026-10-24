import {
  AmountInput, ApplicationView, Decision, DemoWallet, LoanApplicationInput, LoanView, VaultView,
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
// Alice's loan is drawn once the deposit window closes; nothing is lent before that.
const openLoans = () => (phaseAt() === "subscription" ? [] : [loan]);
const lent = () => openLoans().reduce((sum, l) => sum + Number(l.principal), 0);

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

/** The broker approves after brokerSec; the two-signature LoanSet then takes a few seconds. */
function simulateBrokerApproval(app: ApplicationView) {
  setTimeout(() => {
    update(app, "originating");
    setTimeout(async () => update(app, "active", { loanId: hex(), tx: await confirmed() }), 3000);
  }, brokerSec * 1000);
}

/** POST /api/applications: scored at once; 409 during the deposit window (with opensAt) or while one is open (R11). */
async function apply(body: LoanApplicationInput): Promise<ApplicationView> {
  const input = LoanApplicationInput.safeParse(body);
  if (!input.success) throw new ApiError("Check the amount and the number of payments.", 400);
  await settle();
  if (phaseAt() === "subscription") throw new ApiError("Loans open when the deposit window closes.", 409, subscriptionDate);
  const { borrowerAddress, amount, paymentTotal } = input.data;
  if (applications.some((a) => a.borrowerAddress === borrowerAddress && OPEN.includes(a.status))) {
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

export const samples = {
  health: (): HealthResponse => ({ ok: true, mockMode: true, network: "devnet", vaultPhase: phaseAt() }),
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
  loansFor: (borrower?: string) => openLoans().filter((l) => !borrower || l.borrower === borrower),
  timeline: { opened, subscriptionDate, redemptionDate },
};
