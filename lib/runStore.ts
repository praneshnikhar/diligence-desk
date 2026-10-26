// Run history — typed localStorage store.
// SSR-safe (guards typeof window), hydration-safe (callers read after mount),
// and resilient (every access try/caught: private mode / quota / corrupt JSON → empty).
// History is local-only by design: dossier data never leaves this browser.

export type Verdict = "CLEAR" | "REVIEW" | "BLOCK" | "INCOMPLETE";

export type StoredReceipt = {
  signalHash: string;
  minerName?: string;
  costUsd?: number;
  txHash?: string;
  intent: string;
  stepLabel: string;
  amountUusdc?: string;
  epochId?: number;
  timestamp?: number; // unix seconds
  verified?: boolean | null;
};

export type StoredRun = {
  runId: string;
  at: string; // ISO timestamp
  mission: string;
  missionName: string;
  inputSummary: string; // first field value, trimmed to 80 chars
  verdict: Verdict;
  totalCalls: number;
  totalSpentUsd: number;
  receipts: StoredReceipt[];
  verified?: boolean;
};

export const RUNS_KEY = "dd.runs.v1";
const DOSSIER_PREFIX = "dd.dossier.";
const DOSSIER_CAP = 25; // full dossiers kept for [load] replay; oldest evicted
const MAX_RUNS = 200;

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function loadRuns(): StoredRun[] {
  const raw = safeGet(RUNS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is StoredRun => Boolean(r && typeof r === "object" && typeof (r as StoredRun).runId === "string"))
      .slice(0, MAX_RUNS);
  } catch {
    return [];
  }
}

/** Persist (newest first, capped). Returns the capped array so callers can setState with it. */
export function saveRuns(runs: StoredRun[]): StoredRun[] {
  const capped = [...runs]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_RUNS);
  safeSet(RUNS_KEY, JSON.stringify(capped));
  return capped;
}

export function saveRun(run: StoredRun): StoredRun[] {
  const rest = loadRuns().filter((r) => r.runId !== run.runId);
  return saveRuns([run, ...rest]);
}

export function deleteRun(runId: string): StoredRun[] {
  return saveRuns(loadRuns().filter((r) => r.runId !== runId));
}

export function clearRuns(): StoredRun[] {
  if (typeof window !== "undefined") {
    try {
      const doomed: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k?.startsWith(DOSSIER_PREFIX)) doomed.push(k);
      }
      for (const k of doomed) window.localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
  saveRuns([]);
  return [];
}

/** Flip one receipt's verified flag; recompute the run-level flag. */
export function updateReceiptVerified(runId: string, signalHash: string, verified: boolean): StoredRun[] {
  const runs = loadRuns();
  const idx = runs.findIndex((r) => r.runId === runId);
  if (idx === -1) return runs;
  const run = runs[idx];
  const receipts = run.receipts.map((r) => (r.signalHash === signalHash ? { ...r, verified } : r));
  const allVerified = receipts.length > 0 && receipts.every((r) => r.verified === true);
  runs[idx] = { ...run, receipts, verified: allVerified };
  return saveRuns(runs);
}

/**
 * Full-dossier cache for [load] replay, key `dd.dossier.{runId}`.
 * Keeps the 25 most recent; evicts the oldest. Compact run records cannot
 * re-render a whole dossier, so this companion store carries the real thing.
 */
export function saveDossier(runId: string, dossier: unknown): void {
  if (typeof window === "undefined") return;
  try {
    const others: Array<{ key: string; at: number }> = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k?.startsWith(DOSSIER_PREFIX) || k === DOSSIER_PREFIX + runId) continue;
      let at = 0;
      try {
        at = Number(JSON.parse(window.localStorage.getItem(k) ?? "{}")?.at) || 0;
      } catch {
        at = 0;
      }
      others.push({ key: k, at });
    }
    others.sort((a, b) => b.at - a.at);
    for (const e of others.slice(DOSSIER_CAP - 1)) window.localStorage.removeItem(e.key);
  } catch {
    /* ignore */
  }
  safeSet(DOSSIER_PREFIX + runId, JSON.stringify({ at: Date.now(), dossier }));
}

export function loadDossier(runId: string): unknown {
  const raw = safeGet(DOSSIER_PREFIX + runId);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { dossier?: unknown } | null;
    return parsed?.dossier ?? null;
  } catch {
    return null;
  }
}

export function runsTotals(runs: StoredRun[]): { totalRuns: number; totalSpentUsd: number; totalReceipts: number } {
  let totalSpentUsd = 0;
  let totalReceipts = 0;
  for (const r of runs) {
    totalSpentUsd += r.totalSpentUsd ?? 0;
    totalReceipts += r.receipts?.length ?? 0;
  }
  return { totalRuns: runs.length, totalSpentUsd, totalReceipts };
}
