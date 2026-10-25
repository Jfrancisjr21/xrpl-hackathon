-- Run on every start; IF NOT EXISTS makes it safe to repeat. Dates are ISO 8601 strings written by the API (R15).

CREATE TABLE IF NOT EXISTS applications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  borrower_address TEXT NOT NULL,
  amount           TEXT NOT NULL,          -- decimal string, never a float
  payment_total    INTEGER NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('denied','pending_review','rejected','originating','active','failed')),
  decision_json    TEXT NOT NULL,          -- the full Decision from @hack/risk
  decision_hash    TEXT,                   -- Feature 1: SHA-256 hex of decision_json
  loan_id          TEXT UNIQUE,            -- set once the LoanSet validates; UNIQUE so a loan is never recorded twice
  tx_json          TEXT,                   -- TxResult of the LoanSet
  loan_outcome     TEXT CHECK (loan_outcome IN ('paid','defaulted')), -- feeds the paid-off history and the ban list
  broker_note      TEXT,
  error            TEXT,                   -- why origination failed
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- R11: at most one open application per borrower, enforced by the database itself.
-- An active application stops counting once its loan is paid off or defaulted (loan_outcome set).
-- Dropped and recreated on start so existing databases pick up rule changes.
DROP INDEX IF EXISTS one_open_application_per_borrower;
CREATE UNIQUE INDEX one_open_application_per_borrower
  ON applications (borrower_address) WHERE status IN ('pending_review','originating','active') AND loan_outcome IS NULL;

CREATE INDEX IF NOT EXISTS applications_by_status ON applications (status);

-- R10: every payment is recorded so revenue can show interest collected.
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id        TEXT NOT NULL,
  application_id INTEGER NOT NULL REFERENCES applications (id),
  mode           TEXT NOT NULL CHECK (mode IN ('installment','payoff')),
  amount         TEXT NOT NULL,
  principal_paid TEXT,                     -- drop in outstanding principal; the rest of amount is interest + service fee
  interest       TEXT,
  service_fee    TEXT,
  tx_hash        TEXT NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  at             TEXT NOT NULL,
  actor          TEXT NOT NULL CHECK (actor IN ('agent','broker','borrower','depositor','system')),
  action         TEXT NOT NULL,
  application_id INTEGER,
  loan_id        TEXT,
  tx_json        TEXT,
  note           TEXT
);

-- Addresses that defaulted on a loan with us. Checked on every application.
CREATE TABLE IF NOT EXISTS ban_list (
  address    TEXT PRIMARY KEY,
  reason     TEXT NOT NULL,
  loan_id    TEXT,
  created_at TEXT NOT NULL
);

-- Recent credit pulls (summary only: scores and reason codes), reused for 24 h so repeat applications
-- and restarts do not spend the bureau's limited pulls.
CREATE TABLE IF NOT EXISTS credit_reports (
  address      TEXT PRIMARY KEY,
  summary_json TEXT NOT NULL,
  pulled_at    TEXT NOT NULL
);

-- Feature 5: one row per score passport we tried to issue. The ledger is the source of truth; this is our audit trail.
CREATE TABLE IF NOT EXISTS score_tokens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id INTEGER NOT NULL REFERENCES applications (id),
  wallet         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','minted','held','failed','revoked')),
  nft_id         TEXT,
  cid            TEXT,
  mint_tx_json   TEXT,
  move_tx_json   TEXT,
  error          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS score_tokens_by_wallet ON score_tokens (wallet);

-- Small settings the broker changes from the dashboard: agent paused, minimum score.
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
