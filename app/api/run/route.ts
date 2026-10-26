import { NextRequest, NextResponse } from "next/server";
import { MISSIONS, Mission } from "@/lib/intents";
import { LIMITS, assertCanProceed } from "@/lib/limits";
import { telegraphAskWithRetry, ENGINE_URL } from "@/lib/telegraph";
import { newLedger, addToLedger, ledgerSummary, Ledger } from "@/lib/ledger";
import { assessStep, summarize, VERDICT_DISCLAIMER } from "@/lib/verdict";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";
export const maxDuration = 60;

function walletAddress(): string | null {
  const key = process.env.TELEGRAPH_EVM_PRIVATE_KEY;
  if (!key) return null;
  try {
    return privateKeyToAccount(key as `0x${string}`).address;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const wallet = walletAddress();
  if (!wallet) {
    return NextResponse.json({ error: "No burner wallet configured — run `npm run new-wallet`" }, { status: 500 });
  }

  let body: { mission?: string; input?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON body" }, { status: 400 });
  }

  const mission = MISSIONS[body.mission as keyof typeof MISSIONS];
  if (!mission) return NextResponse.json({ error: "Unknown mission" }, { status: 400 });
  const input = body.input ?? {};

  // validate required fields
  for (const f of mission.fields) {
    if (f.required && !input[f.name]?.trim()) {
      return NextResponse.json({ error: `Missing required field: ${f.label}` }, { status: 400 });
    }
  }

  const plan = mission.steps.filter((s) => !s.requires || input[s.requires]?.trim());
  if (plan.length > LIMITS.maxCallsPerRun) {
    return NextResponse.json({ error: "Mission exceeds per-run call cap" }, { status: 400 });
  }

  const ledger: Ledger = newLedger(wallet);
  const perCallCeiling = LIMITS.perCallPriceCeilingUsd;

  const results = await Promise.allSettled(
    plan.map(async (step) => {
      assertCanProceed(ledger.totalCalls, ledger.totalSpentUsd); // throw if over budget
      const query = step.build(input);
      const { call, attempts } = await telegraphAskWithRetry(query, step.intent);
      if (call.error) {
        addToLedger(ledger, { key: step.key, intent: step.intent, error: call.error, attempts });
        return { step, call, assessed: null, skippedReason: undefined as string | undefined };
      }
      // Spending guard after the fact (a paid call returned): verify within limits.
      if ((call.costUsd ?? 0) > perCallCeiling) {
        call.error = `price $${call.costUsd} exceeded the per-call ceiling — refused`;
        addToLedger(ledger, { key: step.key, intent: call.intent ?? step.intent, error: call.error, costUsd: 0 });
        return { step, call, assessed: null, skippedReason: undefined };
      }
      const text = typeof call.result === "string" ? call.result : JSON.stringify(call.result ?? "");
      const assessed = assessStep(step.key, text);
      addToLedger(ledger, {
        key: step.key,
        intent: call.intent ?? step.intent,
        minerName: call.minerName,
        minerId: call.minerId,
        costUsd: call.costUsd ?? 0,
        durationMs: call.durationMs,
        signalHash: call.signalHash,
        receipt: call.receipt,
        attempts,
      });
      return { step, call, assessed, skippedReason: undefined as string | undefined };
    })
  );

  const steps = results.map((r, idx) => {
    const step = plan[idx];
    if (r.status === "rejected") {
      const reason = (r.reason as Error)?.message ?? "rejected";
      const overBudget = /Spend cap/.test(reason);
      return {
        key: step.key,
        label: step.label,
        intent: step.intent,
        status: "error",
        excerpt: overBudget ? "(skipped: per-run budget already allocated)" : "(call failed)",
        error: reason,
        skippedReason: overBudget ? reason : undefined,
        call: null,
      };
    }
    const { step: _s, call, assessed, skippedReason } = r.value;
    return {
      key: step.key,
      label: step.label,
      intent: call?.intent ?? step.intent,
      status: assessed?.status ?? "error",
      excerpt: assessed?.excerpt ?? call?.error ?? "(no result)",
      skippedReason,
      call: call
        ? {
            raw: call.raw,
            minerName: call.minerName,
            minerId: call.minerId,
            costUsd: call.costUsd,
            durationMs: call.durationMs,
            signalHash: call.signalHash,
            reasoning: call.reasoning,
            receipt: call.receipt,
            httpStatus: call.httpStatus,
          }
        : null,
    };
  });

  const verdict = summarize(steps.map((s) => s.status));
  const dossier = {
    mission: mission.slug,
    missionName: mission.name,
    input,
    verdict,
    steps,
    ledger: { ...ledger, summary: ledgerSummary(ledger) },
    engine: ENGINE_URL,
    disclaimer: VERDICT_DISCLAIMER,
  };
  return NextResponse.json(dossier);
}
