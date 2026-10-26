// Run ledger — one entry per PAID call, captured at call time and returned to the UI.
// This is the artifact judges inspect: cost, miner, intent, receipt, signal hash per request.

import type { TelegraphReceipt } from "./telegraph";

export type LedgerEntry = {
  key: string; // step key
  intent?: string;
  minerName?: string;
  minerId?: string;
  costUsd?: number;
  durationMs?: number;
  signalHash?: string;
  receipt?: TelegraphReceipt;
  error?: string;
  attempts?: number; // routing retries used (1 = first ask succeeded)
  route?: string; // "direct:slug" (pinned miner) or "router" (LLM router) — evidence transparency
};

export type Ledger = {
  runId: string;
  startedAt: string;
  entries: LedgerEntry[];
  totalSpentUsd: number;
  totalCalls: number;
  wallet: string;
};

export function newLedger(wallet: string): Ledger {
  return {
    runId: `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    startedAt: new Date().toISOString(),
    entries: [],
    totalSpentUsd: 0,
    totalCalls: 0,
    wallet,
  };
}

export function addToLedger(l: Ledger, e: LedgerEntry) {
  l.entries.push(e);
  if (e.error) return; // failed calls are not charged (settle only on 2xx)
  l.totalCalls += 1;
  l.totalSpentUsd += e.costUsd ?? 0;
}

export function ledgerSummary(l: Ledger) {
  const receipts = l.entries.filter((e) => e.receipt).length;
  return `${l.totalCalls} paid requests · ${receipts} receipts · $${l.totalSpentUsd.toFixed(4)} · wallet ${l.wallet?.slice(0, 8)}…${l.wallet?.slice(-4)}`;
}

export function toEvidence(l: Ledger, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ ledger: l, ...extra }, null, 2);
}
