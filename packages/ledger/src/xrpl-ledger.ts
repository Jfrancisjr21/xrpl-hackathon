import { rippleTimeToUnixTime, type Client, type Wallet } from "xrpl";
import { connect, disconnect, explorerUrl, ledgerCloseTime } from "./client";
import { loadWallets } from "./wallets";
import { readState, saveState, type LedgerState } from "./state";
import { setupAccess } from "./access";
import { createAsset } from "./asset";
import { createVault, vaultDeposit, vaultWithdraw, vaultInfo, vaultPhase, getDepositorPosition } from "./vault";
import { createLoanBroker, coverDeposit, coverWithdraw, brokerEntry } from "./broker";
import { originate, payLoan, manageLoan, deleteLoan, getLoanSnapshot, loanEntry } from "./loan";
import { getAccountFacts } from "./account";
import { DEMO_PROFILES } from "./demo-profiles";
import { LedgerNotReadyError } from "./errors";
import type {
  BrokerSnapshot, DemoWallet, DepositorPosition, FactsResult, LedgerService, LoanSnapshot, LoanTerms,
  PayMode, Role, TxResult, VaultSnapshot,
} from "./types";

const toTx = (r: { hash: string; result: string }): TxResult => ({ hash: r.hash, result: r.result, explorerUrl: explorerUrl(r.hash) });
const iso = (ripple?: number) => (ripple ? new Date(rippleTimeToUnixTime(ripple)).toISOString() : null);
const envInt = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

export class XrplLedger implements LedgerService {
  private wallets?: Record<Role, Wallet>;

  async init() {
    await connect();
    this.wallets ??= loadWallets();
  }
  async close() { await disconnect(); }

  private c(): Promise<Client> { return connect(); } // reconnects if the socket dropped
  private get w(): Record<Role, Wallet> {
    if (!this.wallets) throw new Error("Call ledger.init() first");
    return this.wallets;
  }
  private walletFor(address: string): Wallet {
    const found = Object.values(this.w).find((x) => x.address === address);
    if (!found) throw new Error("No demo wallet for " + address);
    return found;
  }
  private ready(): Required<Pick<LedgerState, "mptId" | "vaultId" | "loanBrokerId" | "subscriptionDate" | "redemptionDate">> {
    const s = readState();
    if (!s.mptId || !s.vaultId || !s.loanBrokerId || !s.subscriptionDate || !s.redemptionDate) {
      throw new Error("Ledger not bootstrapped: run pnpm ledger:bootstrap or restart the API");
    }
    return s as any;
  }

  // Safe to run any number of times: each step is skipped when its ID is already in state.json.
  async bootstrap() {
    const c = await this.c(), w = this.w;
    let s = readState();
    if (!s.domainId) s = saveState({ domainId: await setupAccess(c, w) });
    if (!s.mptId) s = saveState({ mptId: await createAsset(c, w) });
    if (!s.vaultId) {
      s = saveState(await createVault(c, w.broker, s.mptId!, s.domainId!,
        envInt("VAULT_SUBSCRIPTION_SEC", 300), envInt("VAULT_TERM_SEC", 7200)));
    }
    if (!s.loanBrokerId) s = saveState({ loanBrokerId: await createLoanBroker(c, w.broker, s.vaultId!) });

    const now = await ledgerCloseTime(c);
    const v = await vaultInfo(c, s.vaultId!);
    if (Number(v.AssetsTotal ?? 0) === 0 && vaultPhase(now, s.subscriptionDate, s.redemptionDate) === "subscription") {
      await vaultDeposit(c, w.depositor, s.vaultId!, s.mptId!, "10000");
    }
    const b = await brokerEntry(c, s.loanBrokerId!);
    if (Number(b.CoverAvailable ?? 0) === 0) await coverDeposit(c, w.broker, s.loanBrokerId!, s.mptId!, "1000");
    return { vaultId: s.vaultId!, loanBrokerId: s.loanBrokerId!, assetId: s.mptId! };
  }

  getWallets(): DemoWallet[] {
    return (Object.keys(this.w) as Role[]).map((role) => ({
      role,
      label: DEMO_PROFILES[role]?.label ?? role,
      description: DEMO_PROFILES[role]?.description,
      address: this.w[role].address,
    }));
  }

  async getVault(): Promise<VaultSnapshot> {
    const c = await this.c(), s = this.ready();
    const [v, now] = await Promise.all([vaultInfo(c, s.vaultId), ledgerCloseTime(c)]);
    const total = Number(v.AssetsTotal ?? 0), avail = Number(v.AssetsAvailable ?? 0);
    return {
      vaultId: s.vaultId, assetLabel: "TSTUSD",
      assetsTotal: String(v.AssetsTotal ?? "0"),
      assetsAvailable: String(v.AssetsAvailable ?? "0"),
      lossUnrealized: String(v.LossUnrealized ?? "0"),
      utilizationPct: total ? ((total - avail) / total) * 100 : 0,
      phase: vaultPhase(now, s.subscriptionDate, s.redemptionDate),
      subscriptionDate: iso(s.subscriptionDate),
      redemptionDate: iso(s.redemptionDate),
    };
  }

  async getPosition(address: string): Promise<DepositorPosition> {
    return getDepositorPosition(await this.c(), this.ready().vaultId, address);
  }

  async getBroker(): Promise<BrokerSnapshot> {
    const s = this.ready();
    const e = await brokerEntry(await this.c(), s.loanBrokerId);
    return {
      loanBrokerId: s.loanBrokerId,
      debtTotal: String(e.DebtTotal ?? "0"),
      debtMaximum: e.DebtMaximum != null ? String(e.DebtMaximum) : undefined,
      coverAvailable: String(e.CoverAvailable ?? "0"),
      coverRateMinimum: e.CoverRateMinimum ?? 0,
      coverRateLiquidation: e.CoverRateLiquidation ?? 0,
      managementFeeRate: e.ManagementFeeRate ?? 0,
    };
  }

  async deposit(address: string, amount: string) {
    const s = this.ready();
    return toTx(await vaultDeposit(await this.c(), this.walletFor(address), s.vaultId, s.mptId, amount));
  }
  async withdraw(address: string, amount: string) {
    const s = this.ready();
    return toTx(await vaultWithdraw(await this.c(), this.walletFor(address), s.vaultId, s.mptId, amount));
  }
  async depositCover(amount: string) {
    const s = this.ready();
    return toTx(await coverDeposit(await this.c(), this.w.broker, s.loanBrokerId, s.mptId, amount));
  }
  async withdrawCover(amount: string) {
    const s = this.ready();
    return toTx(await coverWithdraw(await this.c(), this.w.broker, s.loanBrokerId, s.mptId, amount));
  }

  async originateLoan(t: LoanTerms) {
    const c = await this.c(), s = this.ready();
    const now = await ledgerCloseTime(c);
    const phase = vaultPhase(now, s.subscriptionDate, s.redemptionDate);
    if (phase === "subscription") {
      throw new LedgerNotReadyError("Loans open when the deposit window closes", iso(s.subscriptionDate));
    }
    // The last payment must be due at least 60 seconds before the redemption date.
    const lastDue = now + t.paymentTotal * t.paymentIntervalSec;
    if (phase === "redemption" || lastDue > s.redemptionDate - 60) {
      throw new LedgerNotReadyError("This loan would end after the vault's redemption date. Shorten it, or run pnpm ledger:new-vault", null);
    }
    const r = await originate(c, this.w.broker, this.walletFor(t.borrower), s.loanBrokerId, t);
    return { loanId: r.loanId, tx: toTx(r) };
  }

  async payLoan(loanId: string, mode: PayMode) {
    const c = await this.c(), s = this.ready();
    const e = await loanEntry(c, loanId);
    const { tx, amount } = await payLoan(c, this.walletFor(e.Borrower), loanId, s.mptId, mode);
    return { tx: toTx(tx), amount };
  }
  async manageLoan(loanId: string, action: "impair" | "unimpair" | "default") {
    return toTx(await manageLoan(await this.c(), this.w.broker, loanId, action));
  }
  async deleteLoan(loanId: string) {
    return toTx(await deleteLoan(await this.c(), this.w.broker, loanId));
  }
  async getLoan(loanId: string): Promise<LoanSnapshot> {
    return getLoanSnapshot(await this.c(), loanId);
  }

  async setAgentDelegation(_enabled: boolean): Promise<TxResult | null> { return null; } // Feature 3

  async getAccountFacts(address: string): Promise<FactsResult> {
    const role = (Object.keys(this.w) as Role[]).find((r) => this.w[r].address === address);
    const facts = role ? DEMO_PROFILES[role]?.facts : undefined;
    if (facts) return { facts, featureSource: "demo-profile" };
    return { facts: await getAccountFacts(await this.c(), address, this.w.issuer.address), featureSource: "ledger" };
  }
}