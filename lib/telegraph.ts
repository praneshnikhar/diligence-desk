// Telegraph Engine wrapper — x402 pay-per-call over HTTP.
// Docs: https://docs.telegraphprotocol.com/docs/using/engine-ask.md
// ! The ONLY place that touches the private key. Server-side only. Never imported into client code.

const NODE_URL = process.env.TELEGRAPH_NODE_URL ?? "https://devnode.telegraphprotocol.com";
export const ENGINE_URL = `${NODE_URL}/engine`;

export type TelegraphReceipt = {
  receipt_hash: string;
  rail: string;
  payer: string;
  miner: string;
  intent: string;
  amount_uusdc: string;
  epoch_id: number;
  settlement: string;
  chain: string;
  tx_hash: string;
  timestamp: number;
};

export type TelegraphCall = {
  intent?: string;
  minerId?: string;
  minerName?: string;
  costUsd?: number;
  durationMs?: number;
  result: unknown;
  signalHash?: string;
  reasoning?: string;
  receipt?: TelegraphReceipt;
  httpStatus?: number;
  error?: string;
  raw: unknown;
};

// ---------- payment plumbing ----------

type PaidFetch = (url: string, init?: RequestInit) => Promise<Response>;

let cachedPaidFetch: PaidFetch | null = null;

async function getPaidFetch(): Promise<PaidFetch> {
  if (cachedPaidFetch) return cachedPaidFetch;
  const key = process.env.TELEGRAPH_EVM_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "TELEGRAPH_EVM_PRIVATE_KEY is not set — run `npm run new-wallet` and copy the key into .env.local"
    );
  }
  try {
    // x402 v2 signer API. The two documented call shapes differ between doc versions,
    // so try the signature-bearing form first and fall back.
    const [{ wrapFetchWithPayment }, { createSigner }] = await Promise.all([
      import("@x402/fetch"),
      import("@x402/evm"),
    ]);
    let signer: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signer = await (createSigner as any)("eip155:84532", key);
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signer = await (createSigner as any)(key);
    }
    cachedPaidFetch = wrapFetchWithPayment(globalThis.fetch, signer as never) as PaidFetch;
    return cachedPaidFetch;
  } catch (err) {
    throw new Error(`x402 client init failed: ${(err as Error).message}`);
  }
}

function decodeReceipt(res: Response): TelegraphReceipt | undefined {
  const b64 = res.headers.get("x-telegraph-receipt");
  if (!b64) return undefined;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as TelegraphReceipt;
  } catch {
    return undefined;
  }
}

// ---------- calls ----------

/** Auto-routed paid ask: POST /engine/v1/ask — Engine's LLM router picks the miner. */
export async function telegraphAsk(query: string): Promise<TelegraphCall> {
  const paid = await getPaidFetch();
  const res = await paid(`${ENGINE_URL}/v1/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const receipt = decodeReceipt(res);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  if (!res.ok) {
    return {
      raw: data ?? text,
      result: null,
      httpStatus: res.status,
      error: d?.error ?? `HTTP ${res.status}`,
      receipt,
    };
  }
  return {
    result: d?.result,
    intent: d?.intent,
    minerId: d?.miner_id,
    minerName: d?.miner_name,
    costUsd: typeof d?.cost_usd === "number" ? d.cost_usd : undefined,
    durationMs: d?.duration_ms,
    reasoning: d?.reasoning,
    signalHash: d?.signal_hash,
    receipt,
    httpStatus: res.status,
    raw: data,
  };
}

/** Free lookup of any past call by its signal hash. */
export async function lookupSignal(hash: string): Promise<{ exists: boolean; signal: unknown }> {
  const res = await fetch(`${ENGINE_URL}/v1/signal/${hash}`);
  if (!res.ok) return { exists: false, signal: null };
  return { exists: true, signal: await res.json() };
}

/** Free discovery — how many live miners currently serve an intent. */
export async function intentSupply(intent: string): Promise<number> {
  try {
    const res = await fetch(`${NODE_URL}/engine/v1/intents/${intent}/miners`);
    if (!res.ok) return 0;
    const arr = await res.json();
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}
