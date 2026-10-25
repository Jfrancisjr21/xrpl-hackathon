# Demo script

About 4 minutes. One laptop runs `pnpm dev`. Open three tabs: Lender, Borrower, Broker (`/broker`, with the broker key entered).

## Before the demo (20 minutes ahead)

1. In `apps/api/.env`: `DEMO_FAST_LOANS=true`, `DEMO_MODE=true`, `VAULT_SUBSCRIPTION_SEC=300`, and a `VAULT_TERM_SEC` that outlasts the demo (7200).
2. Make a fresh vault, then restart `pnpm dev`:
   ```bash
   pnpm ledger:new-vault
   ```
   The deposit window is now open for 5 minutes. Loans can only be approved after it closes.
3. Within those 5 minutes, deposit from the Lender tab (for example 5,000). This is the only time deposits work.
4. Broker tab → Agent → **Reset demo data**. This clears applications, loans, the audit log and the ban list.
5. Run `pnpm smoke`. Every line should say `ok`.
6. Wait for the vault to show the investment phase before going on stage.

## On stage

| # | Tab | Do | Say |
| --- | --- | --- | --- |
| 1 | Lender | Show the vault total and the phase banner | "Lenders pool money in an XRPL vault and earn the interest borrowers pay. The vault is native to the ledger (XLS-65)." |
| 2 | Borrower | Pick **Mallory**, apply for 500 over 3 payments | "First check is sanctions. Mallory is on the list, so she is blocked before we pull any credit." |
| 3 | Borrower | Pick **Bob**, apply | "Bob has no credit file. Instead of a flat no, we offer a secured credit-builder loan at 5%, backed by his own collateral." |
| 4 | Borrower | Pick **Alice**, apply | "Alice: a soft credit pull, 60% of her score, plus 40% from her on-ledger history. Score 87, level A, 7.6%." Point at the score parts and the credit-check line. |
| 5 | Broker | Open Alice's application, click **Approve** | "The agent recommends; a human broker approves. The loan is created on the ledger with the decision's hash in the memo, so anyone can check what we decided." |
| 6 | Borrower | Show **My loan** and the **Score passport** card when it turns "On the ledger" (about 15 s) | "Alice now holds a score passport: an NFT with her score and flags, no personal data. Any lender can verify it." |
| 7 | Borrower | Click **Pay amount due** | "Payments split into principal, interest and our service fee." |
| 8 | Broker | Overview → revenue panel | "We earn a 10% share of interest, plus service and origination fees. Revenue never affects approval." |
| 9 | Broker | Show the overdue alert on Carol's loan if one is up, or the audit log | "Missed payments raise an alert. The broker can impair, then default after the grace period. A default bans the borrower and burns their passport." |

## If something goes wrong

- **Approve answers "Loans open when the deposit window closes"**: the vault is still in its deposit window. Wait for the time it shows.
- **A ledger call fails (502)**: Devnet hiccup. Retry once. Otherwise switch the web app to samples (`VITE_MOCK=true`) and keep talking.
- **"already has an open application" (409)**: that borrower is mid-flow. Use **Reset demo data**, or pick another borrower.
- **Passport stays "Issuing"**: minting runs in the background and takes 10 to 15 s. If it shows "Failed", the broker can reissue it with `POST /api/score-tokens`.

## Honest limits (say them if asked)

- Devnet and test money only. The server holds every demo wallet's key.
- Credit pulls are iSoftpull's sandbox with fictitious applicants, or the built-in demo bureau.
- Borrower wallet histories are seeded demo profiles, since Devnet accounts are new.
- KYC (Didit) and agent-signed loans (Feature 3) are not wired in.
- Passport records live on the minting server; a public IPFS gateway is not set up yet.
- Reset clears our database, not the ledger: a passport minted earlier stays on the ledger until it expires or is revoked.
