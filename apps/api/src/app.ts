import cors from "cors";
import express from "express";
import type { HealthResponse } from "@hack/shared";
import type { Db } from "./db/db";
import { errorHandler } from "./middleware";
import { applicationsRouter } from "./routes/applications";
import type { ApiLedger } from "./services/ledger";
import type { Underwrite } from "./services/underwriting";

// Everything a route needs. index.ts passes the real ones; tests pass fakes.
export interface Deps {
  db: Db;
  ledger: ApiLedger;
  underwrite: Underwrite;
}

const network = (url = "") => (url.includes("devnet") ? "devnet" : url.includes("testnet") ? "testnet" : url || "not configured");

export function createApp(deps: Deps) {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN }));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    const body: HealthResponse = {
      ok: true,
      mockMode: process.env.MOCK_MODE === "true",
      network: network(process.env.XRPL_URL),
      vaultPhase: deps.ledger.getVaultPhase(),
    };
    res.json(body);
  });

  app.get("/api/wallets", (_req, res) => {
    res.json(deps.ledger.getWallets());
  });

  app.use("/api/applications", applicationsRouter(deps));

  app.use(errorHandler); // last: turns every thrown error into ErrorResponse
  return app;
}
