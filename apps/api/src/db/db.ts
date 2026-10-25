import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import type { ApplicationStatus, ApplicationView, AuditEvent, Decision, PayMode, TxResult } from "@hack/shared";

export type Db = Database.Database;

const now = () => new Date().toISOString(); // R15: always ISO 8601, never SQLite's CURRENT_TIMESTAMP

// Opens (or creates) the database and applies the schema. ":memory:" gives a throwaway database for tests.
export function openDb(path = process.env.DATABASE_PATH ?? "app.db"): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  addMissingColumns(db, "payments", ["principal_paid TEXT", "interest TEXT", "service_fee TEXT"]);
  return db;
}

// CREATE TABLE IF NOT EXISTS never changes an existing table, so columns added later are added here.
function addMissingColumns(db: Db, table: string, columns: string[]) {
  const have = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  for (const col of columns) if (!have.has(col.split(" ")[0])) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
}

// ---------- applications ----------

export interface ApplicationRow {
  id: number;
  borrower_address: string;
  amount: string;
  payment_total: number;
  status: ApplicationStatus;
  decision_json: string;
  decision_hash: string | null;
  loan_id: string | null;
  tx_json: string | null;
  loan_outcome: "paid" | "defaulted" | null;
  broker_note: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function toView(r: ApplicationRow): ApplicationView {
  return {
    id: r.id,
    borrowerAddress: r.borrower_address,
    amount: r.amount,
    paymentTotal: r.payment_total,
    status: r.status,
    decision: JSON.parse(r.decision_json) as Decision,
    ...(r.decision_hash ? { decisionHash: r.decision_hash } : {}),
    ...(r.loan_id ? { loanId: r.loan_id } : {}),
    ...(r.tx_json ? { tx: JSON.parse(r.tx_json) as TxResult } : {}),
    ...(r.broker_note ? { brokerNote: r.broker_note } : {}),
    ...(r.error ? { error: r.error } : {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class OpenApplicationError extends Error {} // R11: the borrower already has one open

export function createApplication(
  db: Db,
  a: { borrowerAddress: string; amount: string; paymentTotal: number; status: ApplicationStatus; decision: Decision; decisionHash?: string },
): ApplicationRow {
  const t = now();
  try {
    const { lastInsertRowid } = db
      .prepare(`INSERT INTO applications (borrower_address, amount, payment_total, status, decision_json, decision_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(a.borrowerAddress, a.amount, a.paymentTotal, a.status, JSON.stringify(a.decision), a.decisionHash ?? null, t, t);
    return getApplication(db, Number(lastInsertRowid))!;
  } catch (e) {
    // On insert loan_id is null, so the only unique rule that can fail is one_open_application_per_borrower.
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new OpenApplicationError("This borrower already has an application in review, originating or active");
    }
    throw e;
  }
}

export function getApplication(db: Db, id: number): ApplicationRow | undefined {
  return db.prepare("SELECT * FROM applications WHERE id = ?").get(id) as ApplicationRow | undefined;
}

export function getApplicationByLoan(db: Db, loanId: string): ApplicationRow | undefined {
  return db.prepare("SELECT * FROM applications WHERE loan_id = ?").get(loanId) as ApplicationRow | undefined;
}

// R11: in review, originating, or active with a loan that has not ended yet.
export function hasOpenApplication(db: Db, address: string): boolean {
  return db.prepare(`SELECT 1 FROM applications WHERE borrower_address = ?
                     AND status IN ('pending_review','originating','active') AND loan_outcome IS NULL`).get(address) !== undefined;
}

export function listApplications(db: Db, filter: { status?: ApplicationStatus; borrower?: string } = {}): ApplicationRow[] {
  return db
    .prepare(`SELECT * FROM applications
              WHERE (@status IS NULL OR status = @status) AND (@borrower IS NULL OR borrower_address = @borrower)
              ORDER BY id DESC`)
    .all({ status: filter.status ?? null, borrower: filter.borrower ?? null }) as ApplicationRow[];
}

// Moves an application only if it is still in one of the expected states. Returns undefined when it was not,
// so the route can answer 409 instead of overwriting a move another request already made.
export function transition(
  db: Db,
  id: number,
  from: ApplicationStatus[],
  to: ApplicationStatus,
  patch: { loanId?: string; tx?: TxResult; brokerNote?: string; error?: string } = {},
): ApplicationRow | undefined {
  const { changes } = db
    .prepare(`UPDATE applications
              SET status = ?, updated_at = ?,
                  loan_id = COALESCE(?, loan_id), tx_json = COALESCE(?, tx_json),
                  broker_note = COALESCE(?, broker_note), error = COALESCE(?, error)
              WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`)
    .run(to, now(), patch.loanId ?? null, patch.tx ? JSON.stringify(patch.tx) : null, patch.brokerNote ?? null, patch.error ?? null, id, ...from);
  return changes ? getApplication(db, id) : undefined;
}

// Records how an originated loan ended. A default also puts the borrower on the ban list.
export function closeLoan(db: Db, loanId: string, outcome: "paid" | "defaulted"): void {
  db.transaction(() => {
    const row = db.prepare("SELECT * FROM applications WHERE loan_id = ?").get(loanId) as ApplicationRow | undefined;
    if (!row) return;
    db.prepare("UPDATE applications SET loan_outcome = ?, updated_at = ? WHERE loan_id = ?").run(outcome, now(), loanId);
    if (outcome === "defaulted") ban(db, row.borrower_address, "Defaulted on a loan with us", loanId);
  })();
}

// History for the internal score: loans fully repaid on our platform.
export function loansPaidOff(db: Db, address: string): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM applications WHERE borrower_address = ? AND loan_outcome = 'paid'").get(address) as { n: number };
  return r.n;
}

// ---------- ban list ----------

export function ban(db: Db, address: string, reason: string, loanId?: string): void {
  db.prepare("INSERT OR IGNORE INTO ban_list (address, reason, loan_id, created_at) VALUES (?, ?, ?, ?)").run(address, reason, loanId ?? null, now());
}

export function isBanned(db: Db, address: string): boolean {
  return db.prepare("SELECT 1 FROM ban_list WHERE address = ?").get(address) !== undefined;
}

// ---------- payments (R10) ----------

export function recordPayment(
  db: Db,
  p: { loanId: string; applicationId: number; mode: PayMode; amount: string; txHash: string; principalPaid?: string; interest?: string; serviceFee?: string },
): void {
  db.prepare(`INSERT INTO payments (loan_id, application_id, mode, amount, principal_paid, interest, service_fee, tx_hash, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(p.loanId, p.applicationId, p.mode, p.amount, p.principalPaid ?? null, p.interest ?? null, p.serviceFee ?? null, p.txHash, now());
}

// Totals for the revenue panel. Payments recorded before the split was tracked count as 0 interest.
export function paymentTotals(db: Db): { count: number; interest: number; serviceFees: number } {
  const r = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(CAST(interest AS REAL)), 0) AS interest,
                               COALESCE(SUM(CAST(service_fee AS REAL)), 0) AS serviceFees FROM payments`).get() as
    { count: number; interest: number; serviceFees: number };
  return r;
}

export function originatedLoanCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM applications WHERE loan_id IS NOT NULL").get() as { n: number }).n;
}

export function listPayments(db: Db): {
  loan_id: string; application_id: number; mode: PayMode; amount: string;
  principal_paid: string | null; interest: string | null; service_fee: string | null; tx_hash: string; created_at: string;
}[] {
  return db.prepare(`SELECT loan_id, application_id, mode, amount, principal_paid, interest, service_fee, tx_hash, created_at
                     FROM payments ORDER BY id`).all() as never;
}

// ---------- audit log ----------

export function audit(db: Db, e: Omit<AuditEvent, "id" | "at">): void {
  db.prepare("INSERT INTO audit_events (at, actor, action, application_id, loan_id, tx_json, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(now(), e.actor, e.action, e.applicationId ?? null, e.loanId ?? null, e.tx ? JSON.stringify(e.tx) : null, e.note ?? null);
}

export function listAudit(db: Db, limit = 200): AuditEvent[] {
  const rows = db.prepare("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?").all(limit) as {
    id: number; at: string; actor: AuditEvent["actor"]; action: AuditEvent["action"];
    application_id: number | null; loan_id: string | null; tx_json: string | null; note: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id, at: r.at, actor: r.actor, action: r.action,
    ...(r.application_id !== null ? { applicationId: r.application_id } : {}),
    ...(r.loan_id ? { loanId: r.loan_id } : {}),
    ...(r.tx_json ? { tx: JSON.parse(r.tx_json) as TxResult } : {}),
    ...(r.note ? { note: r.note } : {}),
  }));
}

// ---------- credit pull cache ----------

export function getCachedCredit(db: Db, address: string): { summary_json: string; pulled_at: string } | undefined {
  return db.prepare("SELECT summary_json, pulled_at FROM credit_reports WHERE address = ?").get(address) as never;
}

export function saveCredit(db: Db, address: string, summaryJson: string, pulledAt: string): void {
  db.prepare(`INSERT INTO credit_reports (address, summary_json, pulled_at) VALUES (?, ?, ?)
              ON CONFLICT (address) DO UPDATE SET summary_json = excluded.summary_json, pulled_at = excluded.pulled_at`)
    .run(address, summaryJson, pulledAt);
}

// ---------- config ----------

export function getConfig(db: Db, key: string): string | undefined {
  return (db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}

export function setConfig(db: Db, key: string, value: string): void {
  db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}

// ---------- demo reset (R12) ----------

// Clears every table except credit_reports, so a reset before a rehearsal does not spend real credit pulls again.
// The route guards this with the broker key and DEMO_MODE=true.
export function resetAll(db: Db): void {
  db.exec("DELETE FROM payments; DELETE FROM audit_events; DELETE FROM applications; DELETE FROM ban_list; DELETE FROM config; DELETE FROM sqlite_sequence;");
}
