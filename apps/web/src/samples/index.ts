import {
  AmountInput, ApplicationView, DemoWallet, LoanView, VaultView,
  type HealthResponse, type TxResult, type VaultPhase,
} from "@hack/shared";
import walletsJson from "./demo-wallets.json"; // not wallets.json: the repo gitignores that name (real seeds)
import vaultJson from "./vault.json";
import approvedJson from "./application-approved.json";
import deniedJson from "./application-denied.json";
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
const applications = [applicationApproved, applicationDenied];

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
const confirmed = async (): Promise<TxResult> => {
  await new Promise((r) => setTimeout(r, confirmMs));
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

export const samples = {
  health: (): HealthResponse => ({ ok: true, mockMode: true, network: "devnet", vaultPhase: phaseAt() }),
  wallets,
  vault,
  applicationApproved,
  applicationDenied,
  loan,
  /** As GET /api/vault?address= answers: the position only when an address is given, zero for one that never deposited. */
  vaultFor,
  deposit,
  withdraw,
  applicationsFor: (borrower: string) => applications.filter((a) => a.borrowerAddress === borrower),
  loansFor: (borrower?: string) => openLoans().filter((l) => !borrower || l.borrower === borrower),
  timeline: { opened, subscriptionDate, redemptionDate },
};
