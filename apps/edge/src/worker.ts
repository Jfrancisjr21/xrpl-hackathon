import { DurableObject } from "cloudflare:workers";
import { handleAsNodeRequest } from "cloudflare:node";
import { disconnect, readState, useBlobStore, XrplLedger, type RecordStore } from "@hack/ledger";
import { createApp } from "../../api/src/app";
import { migrate, resetAll, type Db } from "../../api/src/db/db";
import { demoBureau } from "../../api/src/services/credit";
import { resetIfIdle, vaultNeedsRebuild } from "../../api/src/services/demo-keeper";
import { createMonitor, type Monitor } from "../../api/src/services/monitor";
import { riskUnderwrite } from "../../api/src/services/underwriting";
import schema from "../../api/src/db/schema.sql";
import { sqlDb } from "./sql-db";

interface Env {
  CONFIANCE: DurableObjectNamespace<Confiance>;
}

const PORT = 8080; // internal only: handleAsNodeRequest hands requests to Express without a network hop
const SECOND = 1000, MINUTE = 60 * SECOND;
const ALERT_CHECK_MS = 10 * SECOND, VAULT_CHECK_MS = 5 * MINUTE, LEDGER_IDLE_MS = MINUTE;

const json = (body: unknown, status = 200) => Response.json(body, { status });

// Everything stateful lives in this one object, so it behaves like the single Node process the API was written for:
// a synchronous SQLite database, and one queue of ledger writes. It has no always-on loop, so jobs that ran on
// timers in Node run when a request arrives instead. Nothing is spent while nobody is using the demo.
export class Confiance extends DurableObject<Env> {
  private db: Db;
  private ledger: XrplLedger;
  private monitor: Monitor;
  private started?: Promise<void>;
  private lastAlertCheck = 0;
  private lastVaultCheck = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const { sql } = ctx.storage;
    sql.exec("CREATE TABLE IF NOT EXISTS blobs (name TEXT PRIMARY KEY, text TEXT NOT NULL)");
    const read = (name: string) => sql.exec<{ text: string }>("SELECT text FROM blobs WHERE name = ?", name).toArray()[0]?.text ?? null;
    const write = (name: string, text: string) => { sql.exec("INSERT OR REPLACE INTO blobs (name, text) VALUES (?, ?)", name, text); };
    useBlobStore({ read, write });
    const passports: RecordStore = {
      put: async (cid, bytes) => write(`passport/${cid}`, bytes.toString("utf8")),
      get: async (cid) => { const text = read(`passport/${cid}`); return text === null ? null : Buffer.from(text); },
    };
    this.db = sqlDb(ctx.storage);
    migrate(this.db, schema);
    this.ledger = new XrplLedger(passports);
    this.monitor = createMonitor({ db: this.db, ledger: this.ledger });
  }

  private isSetUp() {
    return Boolean(readState().loanBrokerId);
  }

  // First run, or a rebuild after a Devnet reset. It takes minutes, so it runs as an alarm: the platform retries a
  // failure, and it does not depend on whoever happened to trigger it staying connected.
  private async setUpLater() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    await this.ledger.recover();
    await this.ledger.bootstrap();
    this.started = undefined;
  }

  private start() {
    return (this.started ??= (async () => {
      await this.ledger.init();
      const underwrite = riskUnderwrite(this.ledger, demoBureau(this.ledger.getWallets()));
      const app = createApp({ db: this.db, ledger: this.ledger, underwrite, alerts: this.monitor.alerts });
      await new Promise<void>((listening) => { app.listen(PORT, () => listening()); });
    })());
  }

  // Replaces the timers from the Node entry point.
  private async catchUp(path: string) {
    const now = Date.now();
    resetIfIdle(this.db, Number(process.env.DEMO_IDLE_RESET_MIN ?? 30) * MINUTE, now);
    if (path === "/api/alerts" && now - this.lastAlertCheck >= ALERT_CHECK_MS) {
      this.lastAlertCheck = now;
      await this.monitor.tick().catch((e) => console.error("monitor:", e));
    }
    if (now - this.lastVaultCheck >= VAULT_CHECK_MS) {
      this.lastVaultCheck = now;
      if (await vaultNeedsRebuild(this.ledger)) {
        resetAll(this.db);
        await this.setUpLater();
      }
    }
  }

  async fetch(request: Request) {
    clearTimeout(this.idleTimer);
    const path = new URL(request.url).pathname;
    if (!this.isSetUp()) {
      await this.setUpLater();
      if (path === "/api/health") return json({ ok: true, mockMode: false, network: "devnet", vaultPhase: null });
      return json({ error: "The demo ledger is being set up. This takes about 3 minutes, so please try again shortly." }, 503);
    }
    try {
      await this.start();
      await this.catchUp(path);
      return await handleAsNodeRequest(PORT, request);
    } finally {
      // Holding the ledger socket open would keep this object in memory and use up the free daily duration.
      this.idleTimer = setTimeout(() => void disconnect(), LEDGER_IDLE_MS);
    }
  }
}

export default {
  fetch(request: Request, env: Env) {
    return env.CONFIANCE.get(env.CONFIANCE.idFromName("demo")).fetch(request);
  },
} satisfies ExportedHandler<Env>;
