import { ApplicationView, DemoWallet, LoanView, VaultView, type HealthResponse } from "@hack/shared";
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
const vault = VaultView.parse(vaultJson);
const applicationApproved = ApplicationView.parse(approvedJson);
const applicationDenied = ApplicationView.parse(deniedJson);
const loan = LoanView.parse(loanJson);

const health: HealthResponse = { ok: true, mockMode: true, network: "devnet", vaultPhase: vault.phase };

const applications = [applicationApproved, applicationDenied];
const loans = [loan];

export const samples = {
  health,
  wallets,
  vault,
  applicationApproved,
  applicationDenied,
  loan,
  /** As GET /api/vault?address= answers: the position only when an address is given, zero for one that never deposited. */
  vaultFor: (address?: string): VaultView => {
    const { position, ...rest } = vault;
    if (!address) return rest;
    return { ...rest, position: position?.address === address ? position : { address, deposited: "0", sharePct: 0 } };
  },
  applicationsFor: (borrower: string) => applications.filter((a) => a.borrowerAddress === borrower),
  loansFor: (borrower?: string) => loans.filter((l) => !borrower || l.borrower === borrower),
};
