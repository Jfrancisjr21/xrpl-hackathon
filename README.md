# [APP NAME]

A lending app on the XRP Ledger. People deposit money into a shared pool, borrowers apply for loans, and the app decides who should get one. A human broker approves every loan, and each decision is saved on the ledger so anyone can check it later.

It runs on the XRPL Devnet (a free test network), so no real money is involved.

## How it works

1. A **depositor** puts test money into the pool.
2. A **borrower** applies. The app checks them against a sanctions list, gives them a score out of 100, and sets an interest rate.
3. The **broker** reviews the application and clicks Approve. The loan is created on the ledger.
4. The borrower repays. If they're late, the broker gets an alert.

## Run it locally

You need Node 20+ and pnpm 10.

```bash
git clone git@github.com:Jfrancisjr21/xrpl-hackathon.git
cd xrpl-hackathon
pnpm install
cp .env.example apps/api/.env
```

Open `apps/api/.env` and set `BROKER_KEY` to the team key (ask Juan).

Then create your test wallets and start the app:

```bash
pnpm ledger:fund-wallets
pnpm dev
```

- App: <http://localhost:5173>
- API check: <http://localhost:3001/api/health>

Never commit `apps/api/.env` or `apps/api/wallets.json`. They hold secrets and are already git-ignored.

## Demo borrowers

Each applies for 500 over 3 payments, with the credit check authorized.

| Borrower | Result |
| --- | --- |
| Alice | Approved: score 87, level A, 7.6% |
| Carol | Approved: score 57, level C, 13.6% (level C allows at most 3 payments) |
| Bob | No credit file: offered a secured credit-builder loan at 5% instead of an unsecured one |
| Mallory | Blocked (on the sanctions list) before any credit check |

## Limits

- Test network only, with test money.
- Borrower histories are made up for the demo.
- The server holds the test wallets' keys so it can sign for everyone.

## Team

Juan (ledger), Ralph (API and risk), Albert (borrower and depositor screens), Ilian (broker dashboard), Farhan (product and demo).
