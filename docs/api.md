# API reference

The API runs on port 3001 (`pnpm dev`). Every request and response body has a zod schema in `packages/shared/src/index.ts`; the type names below refer to those schemas.

## Conventions

- **Amounts** are decimal strings. Amounts you send (deposit, loan, cover) are whole numbers, such as `"500"`.
- **Rates** are tenths of a basis point: `7600` is 7.6%.
- **Dates** are ISO 8601 strings.
- **Broker routes** need the broker key: `x-broker-key: <key>` or `Authorization: Bearer <key>`. A wrong key gets 401; a server still on `BROKER_KEY=change-me` answers 503.
- **Errors** always look like `ErrorResponse`: `{ error, opensAt?, fields? }`.
  - 400: invalid input; `fields` has one message per bad field.
  - 404: not found.
  - 409: not allowed right now (wrong status, R11, agent paused, vault deposit window with `opensAt`, payoff while a payment is overdue).
  - 502: the ledger refused or did not respond; `error` carries the ledger's reason.
- **Ledger writes** take 3 to 5 seconds. Every write returns a `TxResult` with an `explorerUrl`.

## Health and wallets

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/health` | `HealthResponse`: `ok`, `mockMode`, `network`, `vaultPhase` (`null` before bootstrap) |
| GET | `/api/wallets` | `DemoWallet[]`: role, label, address, description |
| GET | `/api/alerts` | `Alert[]`: loans with an overdue payment, refreshed every 10 s |

## Vault

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/vault` (`?address=` adds that wallet's position) | | `VaultView` |
| POST | `/api/vault/deposit` | `MoveFunds` `{ address, amount }` | `TxResult` |
| POST | `/api/vault/withdraw` | `MoveFunds` | `TxResult` |

Deposits only work in the vault's `subscription` phase and withdrawals only in `redemption`; the ledger enforces both.

## Applications

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/applications` | `LoanApplicationInput` `{ borrowerAddress, amount, paymentTotal, creditConsent }` | 201 `ApplicationView` |
| GET | `/api/applications` (`?status=`, `?borrower=`) | | `ApplicationView[]`, newest first |
| GET | `/api/applications/:id` | | `ApplicationView` |
| GET | `/api/applications/:id/receipt` | | `DecisionReceipt`: the stored hash, a recomputed hash and the LoanSet memo (Feature 1) |
| POST | `/api/applications/:id/approve` 🔑 | | `ApplicationView` (`active` with `loanId` and `tx`) |
| POST | `/api/applications/:id/reject` 🔑 | `BrokerNote` `{ note }` | `ApplicationView` (`rejected`) |

- **Underwriting** runs on create, in this order: sanctions → ban list → credit consent → account facts and credit pull → score (60% credit + 40% internal) → policy (levels A/B/C, liquidity and cover caps, secured offer) → price → explanation. Details: the Notion page "Underwriting v2", section "As built".
- **Statuses**: `denied` (final) or `pending_review`; then `rejected`, or `originating` → `active` | `failed`. A secured credit-builder offer is stored as `denied` with `decision.outcome: "secured_offer"`.
- **R11**: a second application while one is in review, originating, or active with an open loan answers 409.
- **Approve** claims the application before signing, so a double approve gets 409. During the vault's deposit window it answers 409 with `opensAt` and the application stays `pending_review`. The LoanSet carries the decision hash as a memo, and the score passport is minted in the background.

## Loans

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/loans` (`?borrower=`) | | `LoanView[]`, open loans first; loans the ledger no longer knows are skipped (R2) |
| POST | `/api/loans/:id/pay` | `PayRequest` `{ mode: "installment" \| "payoff" }` | `PayResult` `{ tx, amount }` |
| POST | `/api/loans/:id/pay-due` | | `PayResult`: pays one installment (R3) |
| POST | `/api/loans/:id/impair` 🔑 | | `TxResult`; 409 until a payment is late |
| POST | `/api/loans/:id/unimpair` 🔑 | | `TxResult` |
| POST | `/api/loans/:id/default` 🔑 | | `TxResult`; 409 until the grace period ends. Bans the borrower and revokes their passport |
| POST | `/api/loans/:id/delete` 🔑 | | `TxResult` |

`:id` is the ledger loan ID. Every payment writes a payments row with the principal, interest and service fee split (R10). A payoff while a payment is overdue answers 409: per XLS-66 only the late installment is accepted then.

## Broker 🔑

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/broker` | | `BrokerView`, with `coverRequired` and `coverHealthy` |
| POST | `/api/broker/cover/deposit` | `CoverMove` `{ amount }` | `TxResult` |
| POST | `/api/broker/cover/withdraw` | `CoverMove` | `TxResult` |
| GET | `/api/broker/revenue` | | `RevenueView`: interest, platform fee, depositor share, service and origination fees |
| GET | `/api/broker/audit` | | `AuditEvent[]`, newest first |

## Agent and demo

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/agent` | | `AgentView` `{ paused, policy: { minScore }, delegationEnabled }` |
| POST | `/api/agent/pause`, `/api/agent/resume` 🔑 | | `AgentView`; while paused, new applications get 409 |
| POST | `/api/agent/policy` 🔑 | `AgentPolicy` `{ minScore }` | `AgentView` |
| POST | `/api/agent/delegation` 🔑 | `AgentDelegation` `{ enabled }` | `TxResult` or `null` (Feature 3 not built) |
| DELETE | `/api/demo/reset` 🔑 | | `{ ok: true }`; needs `DEMO_MODE=true`. Keeps the credit-pull cache |

## Score passport (Feature 5)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/verify/:address` | | `VerifyResult`: public, read from the ledger; `reason` is `no_token` or `expired` when not verified |
| GET | `/api/score-tokens/:address` | | `ScoreTokenView`: our issuing record plus the ledger state |
| POST | `/api/score-tokens` 🔑 | `IssueScoreToken` `{ applicationId, replace? }` | 201 `ScoreTokenView` |
| DELETE | `/api/score-tokens/:address` 🔑 | | `ScoreTokenView` (`revoked`) |
| GET | `/api/passports/:cid` | | The raw record behind the NFT's `ipfs://` URI |

## Settings (`apps/api/.env`)

| Variable | Meaning |
| --- | --- |
| `BROKER_KEY` | The broker key for 🔑 routes |
| `DEMO_FAST_LOANS` | `true`: payments every 60 s with a 60 s grace period |
| `DEMO_MODE` | `true` enables `DELETE /api/demo/reset` |
| `CREDIT_BUREAU` | `demo` (default) or `isoftpull` (with `ISOFTPULL_API_KEY` and `ISOFTPULL_API_SECRET`). Real pulls are cached for 24 h; on failure the demo bureau answers and the decision says `provider: "demo"` |
| `PASSPORT_VALID_DAYS`, `PASSPORT_DIR`, `IPFS_GATEWAY` | Score passport validity, where records are stored, and an optional gateway for records not held locally |
