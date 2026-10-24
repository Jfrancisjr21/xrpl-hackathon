import { timingSafeEqual } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import { LedgerNotReadyError } from "@hack/ledger";
import type { ErrorResponse } from "@hack/shared";
import { OpenApplicationError } from "./db/db";

// Throw from a route to answer with a specific status: throw new HttpError(404, "Application 7 not found").
export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Partial<ErrorResponse> = {}) {
    super(message);
  }
}

// Wrap ledger calls with this so a refused transaction or a dropped connection becomes a 502, not a 500.
export class LedgerError extends Error {}
export async function onLedger<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof LedgerNotReadyError) throw e; // keeps its 409
    throw new LedgerError(e instanceof Error ? e.message : String(e));
  }
}

// zod issues -> { field: first message }, for ErrorResponse.fields.
function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "(request)";
    fields[key] ??= issue.message;
  }
  return fields;
}

// Zod at the door. Parsed (cleaned, coerced) values replace the raw ones, so routes read trusted, typed data.
export function validate(schemas: { body?: z.ZodType; query?: z.ZodType; params?: z.ZodType }): RequestHandler {
  return (req, _res, next) => {
    for (const part of ["params", "query", "body"] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) throw new HttpError(400, `Invalid request ${part}`, { fields: fieldErrors(result.error) });
      // Express 5 makes req.query a getter, so redefine instead of assigning.
      Object.defineProperty(req, part, { value: result.data, writable: true, configurable: true, enumerable: true });
    }
    next();
  };
}

// Broker-only routes: x-broker-key or Authorization: Bearer. Fails closed when no real key is configured.
export const requireBrokerKey: RequestHandler = (req, _res, next) => {
  const expected = process.env.BROKER_KEY;
  if (!expected || expected === "change-me") throw new HttpError(503, "BROKER_KEY is not configured on the server");
  const header = req.header("authorization");
  const given = req.header("x-broker-key") ?? (header?.startsWith("Bearer ") ? header.slice(7) : undefined);
  const a = Buffer.from(given ?? ""), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, "Missing or wrong broker key");
  next();
};

// Last in the chain: every error leaves the API as ErrorResponse { error, opensAt?, fields? }.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const send = (status: number, body: ErrorResponse) => res.status(status).json(body);

  if (err instanceof HttpError) return send(err.status, { error: err.message, ...err.extra });
  if (err instanceof OpenApplicationError) return send(409, { error: err.message });
  if (err instanceof LedgerNotReadyError) return send(409, { error: err.message, opensAt: err.opensAt }); // e.g. a loan during the deposit window
  if (err instanceof LedgerError) return send(502, { error: `The ledger refused or did not respond: ${err.message}` });
  if (err instanceof z.ZodError) return send(400, { error: "Invalid data", fields: fieldErrors(err) });
  if ((err as { type?: string }).type === "entity.parse.failed") return send(400, { error: "Request body is not valid JSON" });

  console.error(err);
  return send(500, { error: "Something went wrong on the server" });
};
