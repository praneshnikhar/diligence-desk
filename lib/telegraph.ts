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
    // x402 v2 client API: x402Client.register(network, ExactEvmScheme(toClientEvmSigner(viemClients)))
    const [{ wrapFetchWithPayment, x402Client }, { ExactEvmScheme, toClientEvmSigner }] = await Promise.all([
      import("@x402/fetch"),
      import("@x402/evm"),
    ]);
    const [{ privateKeyToAccount }] = await Promise.all([import("viem/accounts")]);
    const account = privateKeyToAccount(key as `0x${string}`);
    const evmSigner = toClientEvmSigner(account as never);
    const client = new x402Client().register("eip155:84532", new ExactEvmScheme(evmSigner as never));
    cachedPaidFetch = wrapFetchWithPayment(globalThis.fetch.bind(globalThis), client as never) as PaidFetch;
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

/** Paid ask. Router picks the miner by default; pin one with minerId, optionally sending a structured request. */
export async function telegraphAsk(query: string, minerId?: string, direct?: DirectReq): Promise<TelegraphCall> {
  const paid = await getPaidFetch();
  const url = minerId ? `${ENGINE_URL}/v1/ask/${minerId}` : `${ENGINE_URL}/v1/ask`;
  const body = direct ? { query, ...direct } : { query };
  const res = await paid(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  // Some miners return their own envelope nested inside the node's — unwrap when present.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nested = d?.result && typeof d.result === "object" && "result" in d.result ? d.result.result : d?.result;
  return {
    result: nested,
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

/** Retry once with an intent hint when routing fails — the Engine's LLM router needs phrasing cues. */
const INTENT_HINTS: Record<string, string> = {
  CORPORATE_REGISTRY_LOOKUP:
    "Route by intent: names a company and asks for its official national corporate register record.",
  SANCTIONS_SCREENING_MATCH:
    "Route by intent: a person, company or wallet screened against OFAC, EU or UN sanctions lists.",
  REGULATORY_FILING_MONITOR:
    "Route by intent: queries statutory regulatory filings and financial oversight disclosures.",
  WEB_SEARCH: "Route by intent: needs live web search results.",
  FACT_CHECK: "Route by intent: fact-checks a specific claim with evidence.",
  SMART_CONTRACT_AUDIT:
    "Route by intent: inspects a smart contract at a stated address for vulnerabilities and honeypot patterns.",
  TOKEN_HOLDER_COUNT:
    "Route by intent: names a token contract address and asks how many distinct addresses hold it.",
  ONCHAIN_METRIC_VERIFY:
    "Route by intent: reads a specific on-chain value (supply, balance, contract status) at latest block.",
  SOCIAL_BOT_DETECTION:
    "Route by intent: asks whether a named social account shows automated or coordinated behaviour.",
  ASSET_RESERVE_ATTESTATION:
    "Route by intent: asks for proof-of-reserves or reserve attestation backing a stablecoin or tokenized asset.",
};

export async function telegraphAskWithRetry(
  query: string,
  intent: string
): Promise<{ call: TelegraphCall; attempts: number }> {
  const call = await telegraphAsk(query);
  if (call.error && !call.signalHash) {
    const hint = INTENT_HINTS[intent] ?? "";
    if (hint) {
      const retry = await telegraphAsk(`${query}\n\n(${hint})`);
      if (!retry.error) return { call: retry, attempts: 2 };
      return { call: retry, attempts: 2 }; // keep the second failure for the ledger
    }
  }
  return { call, attempts: 1 };
}

// ---------- direct-ask strategy (free discovery → pinned miners → router fallback) ----------

type MinerRef = { id: string; slug: string; name: string; description?: string };

const minerCache = new Map<string, { at: number; miners: MinerRef[] }>();
const MINER_CACHE_MS = 10 * 60 * 1000;

/** Free discovery: which miners serve an intent right now (cached, so a run costs nothing extra). */
export async function minersForIntent(intent: string): Promise<MinerRef[]> {
  const hit = minerCache.get(intent);
  if (hit && Date.now() - hit.at < MINER_CACHE_MS) return hit.miners;
  try {
    const res = await fetch(`${ENGINE_URL}/v1/intents/${encodeURIComponent(intent)}/miners`);
    if (!res.ok) return [];
    const data = await res.json();
    const miners = ((Array.isArray(data) ? data : data?.miners ?? []) as MinerRef[]).filter((m) => m?.id);
    minerCache.set(intent, { at: Date.now(), miners });
    return miners;
  } catch {
    return [];
  }
}

export type DirectReq = { method: string; endpoint: string; payload: Record<string, unknown> };
export type RunInput = Record<string, string>;

/**
 * Deterministic structured adapters: per intent, an ordered list of specialist miners
 * with published schemas. Payloads are filled from run input — no LLM in the purchase path.
 * Always verified against live discovery before use.
 */
const DIRECT: Record<string, Array<{ slug: string; req: (i: RunInput) => DirectReq }>> = {
  SMART_CONTRACT_AUDIT: [
    {
      slug: "goplus-security",
      req: (i) => ({ method: "GET", endpoint: "/token-security", payload: { chain_id: "8453", contract_addresses: i.contract } }),
    },
    {
      slug: "chainsight-oracle",
      req: (i) => ({ method: "GET", endpoint: "/scaudit", payload: { address: i.contract, chain: "base" } }),
    },
  ],
  TOKEN_HOLDER_COUNT: [
    { slug: "txlens", req: (i) => ({ method: "GET", endpoint: "/token-holders", payload: { token: i.contract, chain: "base" } }) },
    { slug: "chainsight-oracle", req: (i) => ({ method: "GET", endpoint: "/holders", payload: { address: i.contract, chain: "base" } }) },
  ],
  ONCHAIN_METRIC_VERIFY: [
    { slug: "chainsight-oracle", req: (i) => ({ method: "POST", endpoint: "/supply", payload: { symbol: i.symbol, chain: "base" } }) },
  ],
  ASSET_RESERVE_ATTESTATION: [
    { slug: "chainsight-oracle", req: (i) => ({ method: "GET", endpoint: "/assetreserve", payload: { symbol: i.symbol ?? "USDC", chain: "base" } }) },
  ],
  SANCTIONS_SCREENING_MATCH: [
    { slug: "san-ofac-entity", req: (i) => ({ method: "GET", endpoint: "/query", payload: { entity: i.payee ?? i.company } }) },
    { slug: "san-un-list", req: (i) => ({ method: "GET", endpoint: "/query", payload: { entity: i.payee ?? i.company } }) },
  ],
};

export type SmartAsk = { call: TelegraphCall; route: string; attempts: number };

/**
 * Purchase strategy: deterministic structured asks to the best live specialist first,
 * the Engine router (with retry) only as fallback. A settled-but-errored call is returned
 * as-is — never re-paid. Failed free attempts are preserved in the ledger error text.
 */
export async function telegraphAskSmart(query: string, intent: string, input: RunInput): Promise<SmartAsk> {
  const adapters = DIRECT[intent];
  if (adapters?.length) {
    const live = await minersForIntent(intent);
    const failures: string[] = [];
    for (const a of adapters) {
      const m = live.find((x) => x.slug === a.slug);
      if (!m) continue;
      const call = await telegraphAsk(query, m.id, a.req(input));
      if (!call.error || call.signalHash) {
        return { call, route: `direct:${a.slug}`, attempts: 1 };
      }
      failures.push(`${a.slug}: ${call.error.slice(0, 120)}`);
    }
    if (failures.length) {
      const fb = await telegraphAskWithRetry(query, intent);
      if (fb.call.error) fb.call.error += ` [direct attempts failed: ${failures.join(" | ")}]`;
      return { call: fb.call, route: "router", attempts: fb.attempts };
    }
  }
  const fb = await telegraphAskWithRetry(query, intent);
  return { call: fb.call, route: "router", attempts: fb.attempts };
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
