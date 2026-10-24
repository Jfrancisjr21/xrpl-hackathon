import type { DemoWallet } from "@hack/shared";

/** The wallets a user can act as: the depositor and the four demo borrowers. The broker has its own key gate. */
export const USER_ROLES: DemoWallet["role"][] = ["depositor", "alice", "carol", "bob", "borrower"];

export const userWallets = (wallets: DemoWallet[]) => USER_ROLES.flatMap((role) => wallets.filter((w) => w.role === role));

/** The saved wallet if the server still has it (addresses change when the ledger is reset), else the depositor. */
export function pickWallet(wallets: DemoWallet[], savedAddress: string | null): DemoWallet | null {
  const mine = userWallets(wallets);
  return mine.find((w) => w.address === savedAddress) ?? mine[0] ?? null;
}
