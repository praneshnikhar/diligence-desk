# UI Design Brief — Diligence Desk dashboard

Copy this whole document as the prompt to your design LLM. It contains the project context,
exact data contracts, feature list, design tokens, and constraints.

---

## 0. One-liner

**Diligence Desk** — a web app that fires several PAID intelligence requests (x402 micro-payments,
~$0.01 each) at the Telegraph Engine in parallel and assembles a signed diligence dossier with a
verdict (CLEAR / REVIEW / BLOCK), one receipt per claim, and a cost line. Three missions:
Legal diligence (primary), Exchange listing memo, Stablecoin payment compliance.

Design a **single-page dashboard** that extends the existing run view with: run history,
aggregate stats, a receipt ledger browser with batch verification, and print/PDF export.

## 1. Stack & constraints (hard)

- Next.js 15 App Router + TypeScript + React 19. Client component `app/page.tsx`.
- **No Tailwind** — plain CSS in `app/globals.css`, CSS variables, `ui-monospace` stack.
- **No new dependencies** (no chart libs, no UI kits). CSS + inline SVG only.
- Server APIs already exist; do NOT change payment/verdict logic:
  - `POST /api/run` `{mission, input}` → dossier (costs ~$0.01–0.05 testnet USDC per run)
  - `GET /api/wallet` → `{address, usdc, eth, network, explorer}`
  - `GET /api/receipt/[hash]` → `{exists, signal, verifiedAt}` (free on-chain signal lookup)
- Missions/steps are config-driven from `lib/intents.ts` (`MISSIONS`, `MISSION_SLUGS`) —
  never hardcode step names in UI; render generically.
- Run history lives in **localStorage** (no DB). Key suggestion: `dd.runs.v1`.
- Keep both disclaimers ("Heuristic screening… not legal or compliance advice", "Testnet — no
  real money moves") visible at all times.
- Dark terminal aesthetic is the brand. Do not redesign to light mode or a sans-serif look.

## 2. Exact data contracts (TypeScript — trust these, they come from the API)

```ts
type Verdict = "CLEAR" | "REVIEW" | "BLOCK" | "INCOMPLETE";

type Receipt = {
  receipt_hash: string;
  rail: string;            // "x402"
  payer: string;           // 0x…
  miner: string;           // miner id
  intent: string;
  amount_uusdc: string;    // e.g. "10000" = $0.01 (6 decimals)
  epoch_id: number;
  settlement: string;      // "onchain"
  chain: string;           // "eip155:84532"
  tx_hash: string;         // Basescan link: https://sepolia.basescan.org/tx/{tx_hash}
  timestamp: number;       // unix seconds
};

type StepCall = {
  raw: unknown;
  minerName?: string; minerId?: string;
  costUsd?: number; durationMs?: number;
  signalHash?: string;     // lookup key for /api/receipt/{signalHash}
  reasoning?: string;
  receipt?: Receipt | null;
  httpStatus?: number;
};

type Step = {
  key: string; label: string; intent: string;
  status: "clear" | "flag" | "review" | "error" | "unknown";
  excerpt: string;         // raw miner answer, ≤600 chars — show as-is (it's evidence)
  error?: string; skippedReason?: string;
  route?: string;          // "direct:slug" (pinned specialist) | "router" (LLM router) | "aborted"
  call: StepCall | null;
};

type Dossier = {
  mission: string; missionName: string;
  input: Record<string, string>;
  verdict: { verdict: Verdict; confidence: string };   // ← OBJECT, not a string
  steps: Step[];
  ledger: {
    runId: string; startedAt: string; wallet: string;
    totalCalls: number; totalSpentUsd: number;
    entries: unknown[]; summary: string;   // e.g. "5 paid requests · 5 receipts · $0.0500 · wallet 0x2EC236…D4d5"
  };
  engine: string; disclaimer: string;
};

// GET /api/wallet
type Wallet = { address: string; usdc: string | null; eth: string | null; network: string; explorer: string };
```

**Known bug to fix while redesigning:** the current page types `verdict` as a string and renders
`{dossier.verdict}` — the API sends `{verdict, confidence}`, so the banner renders "[object Object]".
Fix: banner shows `verdict.verdict` big + `verdict.confidence` as a subline.

## 3. Existing UI (keep the good bones)

- `h1` "Diligence Desk" + sub-paragraph explaining the paid-intelligence model.
- Mission tabs (`MISSION_SLUGS`) with mission name + number; blurb below.
- Input fields rendered generically from `mission.fields` (label, required*, placeholder).
- Run button showing live expected cost: `≈ $0.0N` (steps that pass their `requires` × $0.01),
  with a spinner that cycles through the mission's intent names while busy.
- Step cards: label + status badge (`clear` green / `flag` red / `review` amber / `error` grey),
  intent line, excerpt, meta line (miner · cost · ms · signal hash → Basescan · "verify" link).
- Spend panel + evidence JSON export (data: URI download).
- Wallet bar + disclaimer.

## 4. Features to design (priority order)

### P0 — Verdict banner fix
Big CLEAR / REVIEW / BLOCK banner + `confidence` subline (e.g. "majority of independent checks
agree clean"). Banner colour: green/amber/red per verdict. INCOMPLETE = grey.

### P0 — Run history (localStorage) + aggregate stats
- Every completed run auto-saved: `{runId, at (ISO), mission, missionName, inputSummary (first
  field value), verdict, totalCalls, totalSpentUsd, receipts: [{signalHash, minerName, costUsd,
  txHash, intent, stepLabel}]}`.
- **Stats strip** (4 cards): total runs · total spent (sum, $0.0000 precision) · total receipts ·
  wallet USDC balance (from /api/wallet).
- **Runs table**: time ago · mission · input summary · verdict badge · calls · cost · receipts
  count · actions [load] [verify all] [delete].
  - [load] re-renders that run's dossier read-only below/inline (so judges can replay).
  - [verify all] batch-calls `/api/receipt/{signalHash}` for every receipt in the run (sequentially,
    show per-hash ✓/✗ as they land), persists verified state in the stored run (`verified: true`).
  - [delete] with confirm().
- "Clear history" text-button with confirm().
- Empty state: one line "No runs yet — buy your first dossier above." + explainer that history is
  local-only (privacy: dossier data never leaves this browser).

### P1 — Receipt ledger browser
Section listing EVERY receipt across all runs (flat, newest first): tx_hash → Basescan link,
signal_hash (truncated, click = open /api/receipt/{hash} JSON in new tab), miner, intent,
amount in $, epoch id, timestamp, verified ✓. Include a per-row verify button. Subline:
"Every claim in every dossier maps to one of these settled payments."

### P1 — Route transparency on step cards
Show `route` as a tiny badge: `direct:slug` (e.g. "direct:goplus-security") vs `router`.
This is evidence the agent pins specialists deterministically and only falls back to the LLM router.

### P2 — Dossier print/PDF export
`window.print()` stylesheet: white background, hide nav chrome, verdict banner + step cards +
spend panel laid out as a document, header "Diligence Desk — {missionName} — {inputSummary} — {date}",
footer disclaimer + wallet + engine URL. One click from the dossier view.

### P2 — Detail drawer on step cards
Click a card → expandable raw JSON view of `call.raw` (collapsible `<details>` or side drawer),
plus full `reasoning` if present. Excerpt stays always-visible.

### P2 — Micro-polish
- Copy-to-clipboard on signal/tx hashes and wallet address.
- Relative timestamps ("4 min ago") with absolute on hover.
- Loading skeleton for step cards while busy; keep the intent-cycling spinner.
- Total spent counter in the header (updates after each run).

## 5. Design tokens (from app/globals.css — reuse exactly)

```css
--bg:#0c0e12; --panel:#13161d; --panel2:#171b24; --line:#232833;
--fg:#e6e9f0; --fg-dim:#9aa3b5; --accent:#7fd4a8; --accent2:#f4c66b; --danger:#e07f7f;
--mono: ui-monospace, SFMono-Regular, Menlo, monospace;
```
Body: bg #0c0e12, mono 14px, content max-width 980px. Cards = panel bg + 1px line border +
8px radius. Badges = 999px pill + coloured border. Verdict colours: CLEAR accent-green,
REVIEW amber, BLOCK red, INCOMPLETE dim. No gradients, no glow, no rounded-2xl cards —
keep it looking like an operator terminal for compliance work.

## 6. Acceptance checklist

- [ ] Verdict banner shows the real verdict word + confidence (no [object Object]).
- [ ] Run a mission → run appears in history without reload; stats strip updates.
- [ ] Reload page → history + stats persist (localStorage).
- [ ] [verify all] marks each receipt ✓ based on the real API response.
- [ ] [load] replays a past dossier read-only.
- [ ] Receipt browser lists all receipts across runs with Basescan links.
- [ ] Route badge visible per step.
- [ ] Print stylesheet produces a clean A4 dossier.
- [ ] Both disclaimers always visible. No new npm dependencies. No changes to lib/telegraph.ts,
      lib/verdict.ts, lib/limits.ts, or any /api route.
- [ ] All existing generic rendering (missions/steps from config) still works.

## 7. Files you may create/modify

- Modify: `app/page.tsx`, `app/globals.css`
- Create: `lib/runStore.ts` (localStorage typed helpers), `app/dashboard.css` (if splitting CSS)
- Do not touch: `lib/telegraph.ts`, `lib/verdict.ts`, `lib/limits.ts`, `lib/ledger.ts`,
  `lib/intents.ts`, anything under `app/api/**`
