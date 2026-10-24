import { Client, type Wallet } from "xrpl";

let client: Client | undefined;

// Reads XRPL_URL at call time, so .env has been loaded. Safe to call often: it reconnects if the socket dropped.
export async function connect(): Promise<Client> {
  const url = process.env.XRPL_URL;
  if (!url) throw new Error("Set XRPL_URL in apps/api/.env (wss://s.devnet.rippletest.net:51233)");
  client ??= new Client(url);
  if (!client.isConnected()) await client.connect();
  return client;
}

export async function disconnect() {
  await client?.disconnect();
  client = undefined;
}

// One ledger write at a time, in the order they were requested.
let queue: Promise<unknown> = Promise.resolve();
export function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

export function checkResult(type: string, res: any) {
  const meta = res.result.meta;
  const code = typeof meta === "object" ? meta.TransactionResult : "unknown";
  if (code !== "tesSUCCESS") throw new Error(`${type} failed with ${code}`);
  return { hash: res.result.hash as string, result: code as string, meta };
}

// Autofill, sign, submit and wait for validation. Throws unless the result is tesSUCCESS.
export function submit(c: Client, wallet: Wallet, tx: any) {
  return serial(async () => {
    const prepared = await c.autofill(tx);
    const signed = wallet.sign(prepared);
    return checkResult(tx.TransactionType, await c.submitAndWait(signed.tx_blob));
  });
}

export function findCreated(meta: any, entryType: string) {
  const node = (meta.AffectedNodes as any[]).find(
    (n) => n.CreatedNode && n.CreatedNode.LedgerEntryType === entryType,
  );
  if (!node) throw new Error("No created " + entryType + " in transaction metadata");
  return node.CreatedNode as { LedgerIndex: string; NewFields: Record<string, any> };
}

// The ledger's own clock, in Ripple epoch seconds. Use it for every "is it time yet" check.
export async function ledgerCloseTime(c: Client): Promise<number> {
  const res: any = await c.request({ command: "ledger", ledger_index: "validated" } as any);
  return res.result.ledger.close_time as number;
}

export async function ledgerEntry(c: Client, index: string) {
  const res: any = await c.request({ command: "ledger_entry", index, ledger_index: "validated" } as any);
  return res.result.node;
}

export const explorerUrl = (hash: string) => `https://devnet.xrpl.org/transactions/${hash}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));