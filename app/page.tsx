"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MISSIONS, MISSION_SLUGS, Mission } from "@/lib/intents";
import {
  StoredRun,
  StoredReceipt,
  Verdict,
  RUNS_KEY,
  loadRuns,
  saveRun,
  deleteRun,
  clearRuns,
  updateReceiptVerified,
  saveDossier,
  loadDossier,
  runsTotals,
} from "@/lib/runStore";

// ---------- API contract types (mirror the server responses exactly) ----------

type Receipt = {
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

type StepCall = {
  raw: unknown;
  minerName?: string;
  minerId?: string;
  costUsd?: number;
  durationMs?: number;
  signalHash?: string;
  reasoning?: string;
  receipt?: Receipt | null;
  httpStatus?: number;
};

type Step = {
  key: string;
  label: string;
  intent: string;
  status: "clear" | "flag" | "review" | "error" | "unknown";
  excerpt: string;
  error?: string;
  skippedReason?: string;
  route?: string;
  call: StepCall | null;
};

type Dossier = {
  mission: string;
  missionName: string;
  input: Record<string, string>;
  verdict: { verdict: Verdict; confidence: string };
  steps: Step[];
  ledger: {
    runId: string;
    startedAt: string;
    wallet: string;
    totalCalls: number;
    totalSpentUsd: number;
    entries: unknown[];
    summary: string;
  };
  engine: string;
  disclaimer: string;
};

type Wallet = { address: string; usdc: string | null; eth: string | null; network: string; explorer: string };

const STATUS_LABEL: Record<Step["status"], string> = {
  clear: "clean",
  flag: "red flag",
  review: "review",
  error: "failed",
  unknown: "unverified",
};

/** Defensive verdict reader — never crash on an unexpected shape. */
function verdictOf(d: Dossier | null): { verdict: Verdict; confidence: string } {
  const v = d?.verdict as { verdict?: unknown; confidence?: unknown } | undefined;
  const word = typeof v?.verdict === "string" && ["CLEAR", "REVIEW", "BLOCK", "INCOMPLETE"].includes(v.verdict)
    ? (v.verdict as Verdict)
    : "INCOMPLETE";
  const confidence = typeof v?.confidence === "string" ? v.confidence : "";
  return { verdict: word, confidence };
}

function timeAgo(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function absTime(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : "—";
}

function trunc(hash: string, head = 8, tail = 6): string {
  return hash.length > head + tail + 1 ? `${hash.slice(0, head)}…${hash.slice(-tail)}` : hash;
}

function uusdcToUsd(amountUusdc?: string): number | undefined {
  const n = Number(amountUusdc);
  return Number.isFinite(n) ? n / 1e6 : undefined;
}

function receiptKey(runId: string, idx: number, rec: StoredReceipt): string {
  return rec.signalHash || `${runId}#${idx}`;
}

// ---------- small components ----------

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      } catch {
        /* give up silently */
      }
    }
    setOk(true);
    setTimeout(() => setOk(false), 1500);
  };
  return (
    <button type="button" className={`copybtn${ok ? " ok" : ""}`} onClick={copy} aria-label={`copy ${label}`}>
      {ok ? "copied ✓" : "copy"}
    </button>
  );
}

function RouteBadge({ route }: { route?: string }) {
  if (!route) return null;
  const cls = route.startsWith("direct:") ? "direct" : route === "router" ? "router" : "aborted";
  const tip = "direct = specialist miner pinned deterministically; router = LLM fallback";
  return (
    <span className={`routebadge ${cls}`} title={tip}>
      {route}
    </span>
  );
}

function VerdictBanner({ dossier }: { dossier: Dossier }) {
  const { verdict, confidence } = verdictOf(dossier);
  return (
    <div className={`verdict-banner v${verdict}`} role="status">
      <div className="k no-print">VERDICT //</div>
      <div className="verdict-word">{verdict}</div>
      {confidence && <div className="verdict-sub">{confidence}</div>}
      <div className="verdict-meta">
        <span>
          run <b style={{ color: "var(--fg)" }}>{dossier.ledger?.runId}</b> <CopyBtn text={dossier.ledger?.runId ?? ""} label="run id" />
        </span>
        <span>{absTime(dossier.ledger?.startedAt ?? "")}</span>
      </div>
    </div>
  );
}

function StepCard({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const c = step.call;
  const status = STATUS_LABEL[step.status] ?? step.status;
  return (
    <div className={`step s${step.status}`}>
      <div className="stephead">
        <b>{step.label}</b>
        <span className="badges">
          <RouteBadge route={step.route} />
          <span className={`badge ${step.status}`}>{status}</span>
        </span>
      </div>
      <div className="intentline">intent: {step.intent}</div>
      {step.skippedReason ? (
        <div className="stepskip">{step.skippedReason}</div>
      ) : step.error ? (
        <div className="steperror">{step.error}</div>
      ) : null}
      {step.excerpt && <div className="excerptblock">{step.excerpt}</div>}
      {c && (
        <div className="stepmeta">
          {c.minerName && <span>miner {c.minerName}</span>}
          {typeof c.costUsd === "number" && <span>${c.costUsd.toFixed(2)}</span>}
          {c.durationMs != null && <span>{c.durationMs}ms</span>}
          {c.signalHash && (
            <span className="hash">
              sig {trunc(c.signalHash)}
              <CopyBtn text={c.signalHash} label="signal hash" />
              {c.receipt?.tx_hash && (
                <a href={`https://sepolia.basescan.org/tx/${c.receipt.tx_hash}`} target="_blank" rel="noreferrer">
                  tx ↗
                </a>
              )}
              <a href={`/api/receipt/${c.signalHash}`} target="_blank" rel="noreferrer">
                verify
              </a>
            </span>
          )}
          <button type="button" className="steptoggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "hide raw ▴" : "raw ▾"}
          </button>
        </div>
      )}
      {open && c && (
        <div className="drawer">
          <pre>{JSON.stringify(c.raw ?? null, null, 2)}</pre>
          {c.reasoning && <div className="reasoning">reasoning: {c.reasoning}</div>}
          {c.minerId != null && <div className="reasoning">minerId: {c.minerId} · httpStatus: {c.httpStatus ?? "—"}</div>}
        </div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="skeleton" aria-hidden>
      <div className="bar w40" />
      <div className="bar w80" />
      <div className="bar w60" />
    </div>
  );
}

// ---------- page ----------

export default function Page() {
  const [missionSlug, setMissionSlug] = useState<Mission["slug"]>("legal");
  const [input, setInput] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [replayId, setReplayId] = useState<string | null>(null);
  const [replayMissing, setReplayMissing] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [mounted, setMounted] = useState(false);
  const [clock, setClock] = useState(0);
  const [verifyState, setVerifyState] = useState<Record<string, boolean | null>>({});
  const [verifyingRun, setVerifyingRun] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const mission = MISSIONS[missionSlug];

  // mount: load persisted state AFTER hydration; wallet fetch is non-fatal
  useEffect(() => {
    setMounted(true);
    setRuns(loadRuns());
    setClock(Date.now());
    fetch("/api/wallet")
      .then((r) => r.json())
      .then((w) => {
        if (!w?.error) setWallet(w as Wallet);
      })
      .catch(() => {});
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === RUNS_KEY) setRuns(loadRuns());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // spinner: cycle intent names while busy
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((n) => n + 1), 1200);
    return () => clearInterval(t);
  }, [busy]);

  // relative timestamps tick
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const eligible = mission.steps.filter((s) => !s.requires || input[s.requires]?.trim());
  const expected = (eligible.length * 0.01).toFixed(2);
  const spinnerMsg = eligible.length ? eligible[tick % eligible.length]?.intent : "buying intelligence…";

  const run = useCallback(async () => {
    if (busy) return; // double-submit guard
    setBusy(true);
    setDossier(null);
    setReplayId(null);
    setReplayMissing(null);
    setErr(null);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mission: missionSlug, input }),
      });
      const data = await res.json();
      if (!res.ok && data?.error) {
        setErr(String(data.error));
        return;
      }
      const d = data as Dossier;
      setDossier(d);
      // persist compact record + full dossier for replay
      const runId = d?.ledger?.runId ?? `run_${Date.now().toString(36)}`;
      const firstField = MISSIONS[missionSlug].fields[0]?.name ?? "";
      const recs: StoredReceipt[] = [];
      for (const s of d.steps ?? []) {
        const c = s.call;
        if (c?.signalHash) {
          recs.push({
            signalHash: c.signalHash,
            minerName: c.minerName,
            costUsd: c.costUsd,
            txHash: c.receipt?.tx_hash,
            intent: s.intent,
            stepLabel: s.label,
            amountUusdc: c.receipt?.amount_uusdc,
            epochId: c.receipt?.epoch_id,
            timestamp: c.receipt?.timestamp,
            verified: null,
          });
        }
      }
      setRuns(
        saveRun({
          runId,
          at: new Date().toISOString(),
          mission: d.mission,
          missionName: d.missionName,
          inputSummary: (d.input?.[firstField] ?? "").trim().slice(0, 80),
          verdict: (d.verdict?.verdict ?? "INCOMPLETE") as Verdict,
          totalCalls: d.ledger?.totalCalls ?? recs.length,
          totalSpentUsd: d.ledger?.totalSpentUsd ?? 0,
          receipts: recs,
        })
      );
      saveDossier(runId, d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, missionSlug, input]);

  const loadRun = useCallback((r: StoredRun) => {
    const d = loadDossier(r.runId) as Dossier | null;
    if (!d || typeof d !== "object" || !d.verdict || !Array.isArray(d.steps)) {
      setReplayMissing(r.runId);
      setDossier(null);
      setReplayId(null);
      return;
    }
    setReplayMissing(null);
    setDossier(d);
    setReplayId(r.runId);
  }, []);

  const verifyOne = useCallback(async (runId: string, idx: number, rec: StoredReceipt) => {
    const key = receiptKey(runId, idx, rec);
    if (!rec.signalHash) {
      setVerifyState((v) => ({ ...v, [key]: false }));
      return;
    }
    try {
      const res = await fetch(`/api/receipt/${rec.signalHash}`);
      const j = await res.json();
      const ok = Boolean(j?.exists);
      setVerifyState((v) => ({ ...v, [key]: ok }));
      setRuns(updateReceiptVerified(runId, rec.signalHash, ok));
    } catch {
      setVerifyState((v) => ({ ...v, [key]: false }));
    }
  }, []);

  const verifyAll = useCallback(
    async (r: StoredRun) => {
      if (verifyingRun) return;
      setVerifyingRun(r.runId);
      try {
        for (let i = 0; i < r.receipts.length; i++) {
          await verifyOne(r.runId, i, r.receipts[i]);
        }
      } finally {
        setVerifyingRun(null);
      }
    },
    [verifyingRun, verifyOne]
  );

  const onTabKey = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next =
      e.key === "ArrowRight"
        ? (idx + 1) % MISSION_SLUGS.length
        : (idx + MISSION_SLUGS.length - 1) % MISSION_SLUGS.length;
    const slug = MISSION_SLUGS[next];
    setMissionSlug(slug);
    setDossier(null);
    setReplayId(null);
    setReplayMissing(null);
    setErr(null);
    document.getElementById(`tab-${slug}`)?.focus();
  };

  const totals = runsTotals(runs);

  // receipt ledger: every receipt across every run, newest run first
  const ledgerRows = useMemo(() => {
    const rows: Array<{ run: StoredRun; rec: StoredReceipt; idx: number }> = [];
    for (const r of runs) r.receipts.forEach((rec, idx) => rows.push({ run: r, rec, idx }));
    return rows.slice().reverse();
  }, [runs]);
  const filteredRows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return ledgerRows;
    return ledgerRows.filter(({ run: r, rec }) =>
      [rec.minerName ?? "", rec.intent ?? "", rec.signalHash ?? "", rec.txHash ?? "", r.missionName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(f)
    );
  }, [ledgerRows, filter]);
  const ledgerTotal = filteredRows.reduce((sum, { rec }) => sum + (rec.costUsd ?? 0), 0);

  const evidenceHref = dossier
    ? `data:application/json,${encodeURIComponent(
        JSON.stringify(
          { ledger: dossier.ledger, steps: dossier.steps.map(({ call, ...rest }) => ({ ...rest })) },
          null,
          2
        )
      )}`
    : "";

  const inputSummaryForPrint = dossier
    ? (dossier.input?.[MISSIONS[(dossier.mission as Mission["slug"])]?.fields?.[0]?.name] ?? "").slice(0, 80)
    : "";

  return (
    <main>
      {/* 1. masthead */}
      <div className="masthead">
        <div className="lead">
          <h1>
            Diligence Desk <span className="cursor-glyph">▍</span>
          </h1>
          <p className="sub">
            Paste an input. The agent buys several pieces of ranked intelligence through the Telegraph
            Engine in parallel — each one an independent miner paid per request over x402 — and assembles
            a signed dossier with one receipt per claim and a cost line.
          </p>
        </div>
        <div className="walletbar no-print">
          <span className="lbl">burner wallet</span>
          {wallet ? (
            <>
              <b>{trunc(wallet.address, 10, 6)}</b> <CopyBtn text={wallet.address} label="wallet address" />
              <br />
              USDC <b>{wallet.usdc ?? "—"}</b> on {wallet.network ?? "Base Sepolia"} ·{" "}
              <a href={wallet.explorer} target="_blank" rel="noreferrer">
                explorer ↗
              </a>
            </>
          ) : (
            <span>wallet unavailable</span>
          )}
        </div>
      </div>

      {/* 2. stats strip */}
      <div className="stats">
        <div className="stat">
          <div className="k">total runs</div>
          <div className="v">{mounted ? totals.totalRuns : "—"}</div>
        </div>
        <div className="stat">
          <div className="k">total spent</div>
          <div className="v">${mounted ? totals.totalSpentUsd.toFixed(4) : "—"}</div>
        </div>
        <div className="stat">
          <div className="k">receipts</div>
          <div className="v">{mounted ? totals.totalReceipts : "—"}</div>
        </div>
        <div className="stat">
          <div className="k">wallet usdc</div>
          <div className="v">{wallet?.usdc ?? "—"}</div>
        </div>
      </div>

      {/* 3. mission tabs */}
      <div className="seclabel no-print">mission</div>
      <div className="missiontabs no-print" role="tablist" aria-label="missions">
        {MISSION_SLUGS.map((slug, idx) => (
          <button
            key={slug}
            id={`tab-${slug}`}
            role="tab"
            aria-selected={slug === missionSlug}
            tabIndex={slug === missionSlug ? 0 : -1}
            onKeyDown={(e) => onTabKey(e, idx)}
            onClick={() => {
              setMissionSlug(slug);
              setDossier(null);
              setReplayId(null);
              setReplayMissing(null);
              setErr(null);
            }}
          >
            {MISSIONS[slug].name} · mission {MISSIONS[slug].missionNo}
          </button>
        ))}
      </div>
      <p className="sub no-print">{mission.blurb}</p>
      <p className="outcome no-print">outcome: {mission.outcome}</p>

      {/* 4. input form */}
      <div className="no-print">
        {mission.fields.map((f) => (
          <label className="field" key={f.name}>
            <span>
              {f.label} {f.required && <span className="req">*</span>}
            </span>
            {f.multiline ? (
              <textarea
                className="txt"
                rows={3}
                placeholder={f.placeholder}
                value={input[f.name] ?? ""}
                onChange={(e) => setInput({ ...input, [f.name]: e.target.value })}
              />
            ) : (
              <input
                className="txt"
                placeholder={f.placeholder}
                value={input[f.name] ?? ""}
                onChange={(e) => setInput({ ...input, [f.name]: e.target.value })}
              />
            )}
          </label>
        ))}

        <button className="run" onClick={run} disabled={busy}>
          {busy ? (
            <>
              <span className="spin">▌</span> buying intelligence…
            </>
          ) : (
            `$ Run — ≈ $${expected}`
          )}
        </button>
        {busy && <p className="sub">{spinnerMsg} paid…</p>}
      </div>

      {err && (
        <div className="errorcard no-print">
          <span>
            {err}. If it&apos;s about a wallet or payment: fund the burner at faucet.circle.com (Base
            Sepolia) and retry.
          </span>
          <button className="btn warn" onClick={run} disabled={busy}>
            retry
          </button>
        </div>
      )}

      {/* replay bar + notices */}
      {replayId && (
        <div className="replaybar no-print">
          <span className="pill">READ-ONLY · replaying run {replayId}</span>
          <button
            className="btn"
            onClick={() => {
              setReplayId(null);
              setDossier(null);
            }}
          >
            back to live
          </button>
        </div>
      )}
      {replayMissing && (
        <div className="notice no-print">
          The full dossier for run {replayMissing} was evicted from local storage (only the 25 most
          recent are kept). The compact record is still in history below.
        </div>
      )}

      {/* 5. result area */}
      {busy && eligible.map((s) => <SkeletonCard key={s.key} />)}

      {!busy && dossier && (
        <div className="result">
          {/* print-only header */}
          <div className="print-only">
            <div className="printhdr">
              Diligence Desk — {dossier.missionName} — {inputSummaryForPrint} —{" "}
              {absTime(dossier.ledger?.startedAt ?? "")}
            </div>
            <div className="printhdr sub2">engine: {dossier.engine}</div>
          </div>

          <VerdictBanner dossier={dossier} />

          {dossier.steps.map((s) => (
            <StepCard key={s.key} step={s} />
          ))}

          <div className="spend">
            <b>Spend panel</b> — {dossier.ledger?.summary}
            <hr className="rule" />
            <div className="foot">
              <span>
                runId {dossier.ledger?.runId} · every claim above maps to a paid request; click{" "}
                <code>verify</code> on any card to fetch the signal the node recorded for it.
              </span>
              <a className="no-print" href={evidenceHref} download={`evidence-${dossier.mission}.json`}>
                export evidence JSON
              </a>
            </div>
          </div>

          {/* print-only footer */}
          <div className="print-only" style={{ marginTop: 14 }}>
            {dossier.disclaimer}
            <br />
            Testnet (Base Sepolia) — no real money moves. Wallet: {dossier.ledger?.wallet}. Engine:{" "}
            {dossier.engine}.
          </div>
        </div>
      )}

      {/* 6. run history */}
      <div className="seclabel no-print">run history (local to this browser)</div>
      <div className="no-print">
        {mounted && runs.length > 0 && (
          <>
            <div style={{ marginBottom: 8 }}>
              <button
                className="btn danger"
                onClick={() => {
                  if (confirm("Delete ALL run history and cached dossiers?")) setRuns(clearRuns());
                }}
              >
                clear history
              </button>
            </div>
            <div className="tablewrap">
              <table className="h">
                <thead>
                  <tr>
                    <th>when</th>
                    <th>mission</th>
                    <th>input</th>
                    <th>verdict</th>
                    <th>calls</th>
                    <th>cost</th>
                    <th>receipts</th>
                    <th>actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.runId}>
                      <td>
                        {timeAgo(r.at, clock || Date.now())}
                        <span className="cellsub" title={absTime(r.at)}>{absTime(r.at)}</span>
                      </td>
                      <td>{r.missionName}</td>
                      <td>
                        {r.inputSummary || "—"}
                        <span className="cellsub">{r.mission}</span>
                      </td>
                      <td>
                        <span className={`badge ${r.verdict === "CLEAR" ? "clear" : r.verdict === "BLOCK" ? "flag" : r.verdict === "REVIEW" ? "review" : "unknown"}`}>
                          {r.verdict}
                        </span>
                      </td>
                      <td>{r.totalCalls}</td>
                      <td>${r.totalSpentUsd.toFixed(2)}</td>
                      <td>
                        {r.receipts.length}
                        {r.verified === true && (
                          <>
                            {" "}
                            <span className="badge verified">✓ all verified</span>
                          </>
                        )}
                      </td>
                      <td>
                        <span className="actions">
                          <button className="btn" onClick={() => loadRun(r)}>
                            load
                          </button>
                          <button
                            className="btn warn"
                            onClick={() => verifyAll(r)}
                            disabled={verifyingRun !== null}
                          >
                            {verifyingRun === r.runId ? "verifying…" : `verify all`}
                          </button>
                          <button
                            className="btn danger"
                            onClick={() => {
                              if (confirm(`Delete run ${r.runId}?`)) setRuns(deleteRun(r.runId));
                            }}
                          >
                            delete
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {mounted && runs.length === 0 && (
          <div className="empty">
            No runs yet — buy your first dossier above. History is local-only: dossier data never
            leaves this browser.
          </div>
        )}
      </div>

      {/* 7. receipt ledger browser */}
      <div className="seclabel no-print">receipt ledger</div>
      <div className="no-print">
        <p className="sub">Every claim in every dossier maps to one of these settled payments.</p>
        {mounted && ledgerRows.length > 0 && (
          <>
            <div className="ledgerfilter">
              <input
                className="txt"
                placeholder="filter by miner / intent / hash…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="tablewrap">
              <table className="h">
                <thead>
                  <tr>
                    <th>tx</th>
                    <th>signal</th>
                    <th>miner</th>
                    <th>intent</th>
                    <th>amount</th>
                    <th>epoch</th>
                    <th>time</th>
                    <th>verified</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(({ run: r, rec, idx }) => {
                    const key = receiptKey(r.runId, idx, rec);
                    const v = rec.verified !== undefined ? rec.verified : verifyState[key] ?? null;
                    return (
                      <tr key={key}>
                        <td>
                          {rec.txHash ? (
                            <a href={`https://sepolia.basescan.org/tx/${rec.txHash}`} target="_blank" rel="noreferrer">
                              {trunc(rec.txHash)}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {rec.signalHash ? (
                            <a href={`/api/receipt/${rec.signalHash}`} target="_blank" rel="noreferrer">
                              {trunc(rec.signalHash)}
                            </a>
                          ) : (
                            <span className="badge failed">no hash</span>
                          )}
                          <CopyBtn text={rec.signalHash} label="signal hash" />
                        </td>
                        <td>{rec.minerName ?? "—"}</td>
                        <td>{rec.intent}</td>
                        <td>${(rec.costUsd ?? uusdcToUsd(rec.amountUusdc) ?? 0).toFixed(2)}</td>
                        <td>{rec.epochId ?? "—"}</td>
                        <td>
                          {rec.timestamp ? absTime(new Date(rec.timestamp * 1000).toISOString()) : "—"}
                        </td>
                        <td>
                          <span className={`badge ${v === true ? "verified" : v === false ? "failed" : "unverified"}`}>
                            {v === true ? "✓ on-chain" : v === false ? "✗ missing" : "—"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn"
                            onClick={() => verifyOne(r.runId, idx, rec)}
                            disabled={verifyingRun !== null || !rec.signalHash}
                          >
                            verify
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="ledgerfoot">
                <span>
                  {filteredRows.length} receipt{filteredRows.length === 1 ? "" : "s"}
                  {filter ? ` (filtered from ${ledgerRows.length})` : ""}
                </span>
                <span>running total ${ledgerTotal.toFixed(4)}</span>
              </div>
            </div>
          </>
        )}
        {mounted && ledgerRows.length === 0 && <div className="empty">No receipts yet.</div>}
      </div>

      {/* 8. sticky disclaimer strip */}
      <footer className="disclaimer-strip">
        <span>Heuristic screening over machine-bought intelligence. Not legal or compliance advice.</span>
        <span>Testnet (Base Sepolia) — no real money moves. Season II · Telegraph Hackathon.</span>
      </footer>
    </main>
  );
}
