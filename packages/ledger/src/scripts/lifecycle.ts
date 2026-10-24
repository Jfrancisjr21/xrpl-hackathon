import "./env";
import { createHash } from "node:crypto";
import { sleep } from "../client";
import { XrplLedger } from "../xrpl-ledger";

console.warn = () => {};
const ledger = new XrplLedger();
await ledger.init();
await ledger.bootstrap();
const addr = (role: string) => ledger.getWallets().find((x) => x.role === role)!.address;
const show = (label: string, tx: { hash: string; explorerUrl: string }) => console.log(label.padEnd(12), tx.explorerUrl);

// Loans only open after the deposit window.
let v = await ledger.getVault();
while (v.phase === "subscription") {
  console.log("deposit window open until", v.subscriptionDate, "- waiting");
  await sleep(10_000);
  v = await ledger.getVault();
}

show("cover in", await ledger.depositCover("50"));
show("cover out", await ledger.withdrawCover("50"));

// Alice: 60-second payments, pay one installment, then let it go late, impair and default.
const memo = createHash("sha256").update("lifecycle-test").digest("hex");
const a = await ledger.originateLoan({
  borrower: addr("alice"), principal: "500", interestRate: 7400,
  paymentTotal: 3, paymentIntervalSec: 60, gracePeriodSec: 60, decisionMemo: memo,
});
show("loan alice", a.tx);
console.log(await ledger.getLoan(a.loanId));
const paid = await ledger.payLoan(a.loanId, "installment");
show("installment", paid.tx);
console.log("paid", paid.amount, await ledger.getLoan(a.loanId));

while (!(await ledger.getLoan(a.loanId)).canImpair) await sleep(5_000);
show("impair", await ledger.manageLoan(a.loanId, "impair"));
while (!(await ledger.getLoan(a.loanId)).canDefault) await sleep(5_000);
show("default", await ledger.manageLoan(a.loanId, "default"));
console.log("alice", (await ledger.getLoan(a.loanId)).status);

// Carol: originate, pay off, delete.
const cl = await ledger.originateLoan({
  borrower: addr("carol"), principal: "300", interestRate: 12800,
  paymentTotal: 2, paymentIntervalSec: 60, gracePeriodSec: 60,
});
show("loan carol", cl.tx);
show("payoff", (await ledger.payLoan(cl.loanId, "payoff")).tx);
console.log("carol", (await ledger.getLoan(cl.loanId)).status);
show("delete", await ledger.deleteLoan(cl.loanId));

console.log("vault", await ledger.getVault());
console.log("broker", await ledger.getBroker());
await ledger.close();