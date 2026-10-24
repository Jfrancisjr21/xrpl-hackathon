import cors from "cors";
import express from "express";
import type { LedgerService } from "@hack/ledger";
import type { HealthResponse, VaultPhase } from "@hack/shared";
import type { Db } from "./db/db";
import { errorHandler } from "./middleware";
import { agentRouter, demoRouter } from "./routes/agent";
import { applicationsRouter } from "./routes/applications";
import { brokerRouter } from "./routes/broker";
import { loansRouter } from "./routes/loans";
import { vaultRouter } from "./routes/vault";
import type { Underwrite } from "./services/underwriting";

// Everything a route needs. index.ts passes the real ones (XrplLedger); tests pass fakes.
export interface Deps {
  db: Db;
  ledger: LedgerService;
  underwrite: Underwrite;
}

const network = (url = "") => (url.includes("devnet") ? "devnet" : url.includes("testnet") ? "testnet" : url || "not configured");

export function createApp(deps: Deps) {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN }));
  app.use(express.json());

  app.get("/api/health", async (_req, res) => {
    // Health must always answer, so a missing vault or a dropped connection shows as vaultPhase: null.
    let vaultPhase: VaultPhase | null = null;
    try {
      vaultPhase = (await deps.ledger.getVault()).phase;
    } catch { /* not bootstrapped or ledger unreachable */ }
    const body: HealthResponse = {
      ok: true,
      mockMode: process.env.MOCK_MODE === "true",
      network: network(process.env.XRPL_URL),
      vaultPhase,
    };
    res.json(body);
  });

  app.get("/api/wallets", (_req, res) => {
    res.json(deps.ledger.getWallets());
  });

  app.use("/api/applications", applicationsRouter(deps));
  app.use("/api/vault", vaultRouter(deps));
  app.use("/api/loans", loansRouter(deps));
  app.use("/api/broker", brokerRouter(deps));
  app.use("/api/agent", agentRouter(deps));
  app.use("/api/demo", demoRouter(deps));

  app.use(errorHandler); // last: turns every thrown error into ErrorResponse
  return app;
}
