import { Router } from "express";
import { AgentDelegation, AgentPolicy, type AgentView } from "@hack/shared";
import type { Deps } from "../app";
import { audit, getConfig, resetAll, setConfig, type Db } from "../db/db";
import { HttpError, onLedger, requireBrokerKey, validate } from "../middleware";

export const DEFAULT_MIN_SCORE = 50;

export function agentView(db: Db): AgentView {
  return {
    paused: getConfig(db, "paused") === "true",
    policy: { minScore: Number(getConfig(db, "minScore") ?? DEFAULT_MIN_SCORE) },
    delegationEnabled: getConfig(db, "delegationEnabled") === "true",
  };
}

export function agentRouter({ db, ledger }: Deps) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(agentView(db));
  });

  // While paused, POST /api/applications answers 409.
  for (const [path, paused] of [["pause", true], ["resume", false]] as const) {
    router.post(`/${path}`, requireBrokerKey, (_req, res) => {
      setConfig(db, "paused", String(paused));
      audit(db, { actor: "broker", action: paused ? "agent_paused" : "agent_resumed" });
      res.json(agentView(db));
    });
  }

  router.post("/policy", requireBrokerKey, validate({ body: AgentPolicy }), (req, res) => {
    const { minScore } = req.body as AgentPolicy;
    setConfig(db, "minScore", String(minScore));
    audit(db, { actor: "broker", action: "policy_updated", note: `minScore ${minScore}` });
    res.json(agentView(db));
  });

  // Feature 3 (two-key approval). The ledger returns null until multi-signing is built.
  router.post("/delegation", requireBrokerKey, validate({ body: AgentDelegation }), async (req, res) => {
    const { enabled } = req.body as AgentDelegation;
    const tx = await onLedger(() => ledger.setAgentDelegation(enabled));
    if (tx) setConfig(db, "delegationEnabled", String(enabled));
    res.json(tx);
  });

  return router;
}

// R12: DELETE /api/demo/reset clears the database before a demo run. Broker key and DEMO_MODE=true required.
export function demoRouter({ db }: Deps) {
  const router = Router();
  router.delete("/reset", requireBrokerKey, (_req, res) => {
    if (process.env.DEMO_MODE !== "true") throw new HttpError(403, "Demo reset is only available with DEMO_MODE=true");
    resetAll(db);
    audit(db, { actor: "system", action: "demo_reset" });
    res.json({ ok: true });
  });
  return router;
}
