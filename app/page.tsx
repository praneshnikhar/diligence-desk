"use client";

import { useCallback, useEffect, useState } from "react";
import { MISSIONS, MISSION_SLUGS, Mission } from "@/lib/intents";

type RunStep = {
  key: string;
  label: string;
  intent: string;
  status: string;
  excerpt: string;
  error?: string;
  skippedReason?: string;
  call: {
    raw: unknown;
    minerName?: string;
    minerId?: string;
    costUsd?: number;
    durationMs?: number;
    signalHash?: string;
    reasoning?: string;
    receipt?: {
      receipt_hash: string;
      amount_uusdc: string;
      epoch_id: number;
      tx_hash: string;
      chain: string;
      settlement: string;
    } | null;
    httpStatus?: number;
  } | null;
};

type Dossier = {
  mission: string;
  missionName: string;
  verdict: string;
  steps: RunStep[];
  ledger: { summary: string; totalCalls: number; totalSpentUsd: number; entries: unknown[] };
  error?: string;
};

const STATUS_LABEL: Record<string, string> = {
  clear: "clean",
  flag: "red flag",
  review: "review",
  error: "failed",
  unknown: "unverified",
};

export default function Page() {
  const [missionSlug, setMissionSlug] = useState<Mission["slug"]>("legal");
  const [input, setInput] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wallet, setWallet] = useState<{ address: string; usdc: string | null; network?: string; explorer: string } | null>(null);

  const mission = MISSIONS[missionSlug];

  useEffect(() => {
    fetch("/api/wallet")
      .then((r) => r.json())
      .then((w) => !w.error && setWallet(w))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((n) => n + 1), 600);
    return () => clearInterval(t);
  }, [busy]);

  const run = useCallback(async () => {
    setBusy(true);
    setDossier(null);
    setErr(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission: missionSlug, input }),
      });
      const data = await res.json();
      if (!res.ok && data?.error) {
        setErr(data.error);
      } else {
        setDossier(data as Dossier);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [missionSlug, input]);

  const stepsPct = dossier ? dossier.ledger.totalCalls : 0;
  const spinnerMsg = mission.steps[stepsPct % mission.steps.length]?.intent ?? "buying intelligence…";

  return (
    <main>
      <h1>Diligence Desk</h1>
      <p className="sub">
        Paste an input. The agent buys several pieces of ranked intelligence through the Telegraph
        Engine in parallel — each one a real paid x402 request — and assembles a signed dossier with
        one receipt per claim and a cost line at the bottom.
      </p>

      <div className="missiontabs">
        {MISSION_SLUGS.map((slug) => (
          <button
            key={slug}
            className={slug === missionSlug ? "on" : ""}
            onClick={() => { setMissionSlug(slug); setDossier(null); setErr(null); }}
          >
            {MISSIONS[slug].name} · mission {MISSIONS[slug].missionNo}
          </button>
        ))}
      </div>
      <p className="sub">{mission.blurb}</p>

      {mission.fields.map((f) => (
        <label className="field" key={f.name}>
          <span>{f.label}{f.required ? " *" : ""}</span>
          {f.multiline ? (
            <textarea className="txt" rows={3} placeholder={f.placeholder} value={input[f.name] ?? ""} onChange={(e) => setInput({ ...input, [f.name]: e.target.value })} />
          ) : (
            <input className="txt" placeholder={f.placeholder} value={input[f.name] ?? ""} onChange={(e) => setInput({ ...input, [f.name]: e.target.value })} />
          )}
        </label>
      ))}

      <button className="run" onClick={run} disabled={busy}>
        {busy ? <><span className="spin">▌</span> buying intelligence…</> : `Run — expected cost ≈ $${(mission.steps.filter((s) => !s.requires || input[s.requires]).length * 0.01).toFixed(2)}`}
      </button>
      {busy && <p className="sub">{spinnerMsg === "buying intelligence…" ? "" : `${spinnerMsg} paid…`}</p>}
      {tick ? null : null}

      {err && (
        <div className="wallet walletbar warning">
          {err}. If it's about a wallet or payment: fund the burner at faucet.circle.com (Base Sepolia) and retry.
        </div>
      )}

      {dossier && (
        <>
          <div className={`verdict ${dossier.verdict}`}>
            {dossier.verdict} — {dossier.missionName}
          </div>

          {dossier.steps.map((s) => (
            <div className="step" key={s.key}>
              <div className="head">
                <b>{s.label}</b>
                <span className={`badge ${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
              </div>
              <div className="intent">intent: {s.intent}</div>
              <div className="excerpt">{s.skippedReason ?? s.excerpt}</div>
              {s.call && (
                <div className="meta">
                  {s.call.minerName && <span>miner {s.call.minerName} · </span>}
                  {typeof s.call.costUsd === "number" && <span>${s.call.costUsd} · </span>}
                  {s.call.durationMs != null && <span>{s.call.durationMs}ms · </span>}
                  {s.call.signalHash && (
                    <>
                      signal <a href={`https://sepolia.basescan.org/tx/${s.call.signalHash}`} target="_blank" rel="noreferrer">{s.call.signalHash.slice(0, 10)}…</a>{" "}
                      <a href={`/api/receipt/${s.call.signalHash}`} target="_blank" rel="noreferrer">verify</a>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="spend">
            <b>Spend panel</b> — {dossier.ledger.summary}
            <br />
            runId {dossier.mission} · every claim above maps to a paid request; click <code>verify</code> on
            any card to fetch the signal the node recorded for it.
            <br />
            <a href={`data:application/json,${encodeURIComponent(JSON.stringify({ ledger: dossier.ledger, steps: dossier.steps.map(({ call, ...rest }) => ({ ...rest })) }, null, 2))}`} download={`evidence-${dossier.mission}.json`}>
              export evidence JSON
            </a>
          </div>
        </>
      )}

      {wallet && (
        <div className="walletbar">
          burner wallet <b>{wallet.address.slice(0, 10)}…{wallet.address.slice(-6)}</b> · USDC balance{" "}
          <b>{wallet.usdc ?? "—"}</b> on {wallet.network ?? "Base Sepolia"} ·{" "}
          <a href={wallet.explorer} target="_blank" rel="noreferrer">explorer</a>
        </div>
      )}
      <div className="wallet disclaimer" style={{ marginTop: 30 }}>
        Heuristic screening over machine-bought intelligence. Not legal or compliance advice. Testnet
        (Base Sepolia) — no real money moves. Season II · Telegraph Hackathon.
      </div>
    </main>
  );
}
