# Diligence Desk

**Agents that buy their own intelligence — and show the receipts.**

One input → the agent fires several **paid** information requests in parallel through the
[Telegraph Engine](https://hackathon.telegraphprotocol.com), each an independent miner paid
per request over **x402** (HTTP-native USDC micropayments) → a signed **diligence dossier**
with a verdict, one on-chain receipt per claim, and a cost line.

> **Try it:** paste a company name, press `$ Run — ≈ $0.05`. Every claim in the result card
> carries its `signal_hash` — click *verify* to fetch the exact evidence the node settled on-chain.

| | |
|---|---|
| **Hackathon** | Telegraph Hackathon Season II (1 Nov → 1 Dec 2026) · **Apps & Agents** track |
| **Missions covered** | **04 Legal diligence** (primary) · **01 Exchange listing memo** · **02 Stablecoin payment compliance** |
| **Stack** | Next.js 15 · TypeScript · `@x402/fetch` + `@x402/evm` v2 · viem · deterministic verdict heuristics (no LLM in the loop) |
| **Network** | Base Sepolia (eip155:84532), x402 **exact** scheme — EIP-3009 authorization, facilitator-settled, **no gas, no ETH needed** |
| **Cost discipline** | $0.25/run cap · 12 calls/run cap · per-call price ceiling — enforced in `lib/limits.ts` |
| **Real money** | **$0.** Testnet USDC only (Circle faucet). Live-session spend: ~$0.30 for 5 full dossiers |

---

## The three missions (all run end-to-end, all receipts on-chain)

### 04 · Legal diligence pack — *primary mission*
Input: a company (+ optional beneficial owner). Five parallel buys:

| Step | Intent | Pinned specialist (deterministic direct-ask) |
|---|---|---|
| Corporate registry | `CORPORATE_REGISTRY_LOOKUP` | router → TxLens / GLEIF |
| Sanctions screening | `SANCTIONS_SCREENING_MATCH` | **direct:** `san-ofac-entity` (OFAC SDN XML) |
| Statutory filings | `REGULATORY_FILING_MONITOR` | router → LiveCert / SEC EDGAR |
| Adverse news | `WEB_SEARCH` | router → live web/HN search |
| Claim verification | `FACT_CHECK` | **direct:** `factwire-fact-check` |

Result: **CLEAR** for a clean company, **BLOCK** when a check hard-fails — every step shows
its raw miner output verbatim, so a human always sees the evidence behind the verdict.

### 01 · Exchange listing memo — *stretch mission*
Input: token contract (+ ticker, treasury wallet, social handle). Contract audit via
**GoPlus** (`direct:`), holder distribution via **ChainSight/Blockscout**, supply +
verification status, treasury sanctions screen. Output: a listing risk memo with receipts.

### 02 · Stablecoin payment compliance — *stretch mission*
Input: payee + amount (+ wallet, payment token). Sanctions screen, registry check, fraud
risk score, **reserve attestation** (`ASSET_RESERVE_ATTESTATION`). Output: a payment that
carries its own compliance proof.

**Flagship demo:** screening *Tornado Cash* today returns `on_list: 0` — the agent reflects
the **March 2025 OFAC delisting** in real time — while the fraud miner still prices the
mixer payment at ~75% risk → verdict **BLOCK**. Fresh lists beat stale lore; the dossier
shows both facts side by side.

---

## Architecture (what makes it an *agent*, not a form)

```
input ──▶ mission config (lib/intents.ts)
          │  5 queries built from templates
          ▼
     PURCHASE STRATEGY (lib/telegraph.ts)         spending guards (lib/limits.ts)
          │                                              │
          ├─ 1. FREE discovery: GET /engine/v1/intents/{intent}/miners  (cached 10 min)
          ├─ 2. DETERMINISTIC direct-ask to pinned specialists:
          │      POST /engine/v1/ask/{minerId}  { query, method, endpoint, payload }
          │      payload filled from run input — no LLM in the purchase path
          ├─ 3. FALLBACK: LLM router POST /engine/v1/ask (+ one intent-hint retry)
          │      a settled-but-errored call is NEVER re-paid
          ▼
     x402 exact: sign EIP-3009 → facilitator settles USDC → miner answers
          ▼
     VERDICT (lib/verdict.ts): deterministic, structural-first heuristics per miner shape
          ▼
     DOSSIER: verdict + steps (raw excerpts, reasoning, receipts) + cost line
```

**Design decisions worth a judge's attention**

1. **Deterministic purchase path.** The Engine's LLM router misroutes generic-word intents
   ("audit" → academic-paper miner). So specialists are pinned via free discovery + structured
   payloads, verified live; the router is only a fallback. Route provenance is a badge on every
   card (`direct:goplus-security` vs `router`).
2. **Structural-first verdicts.** Miner JSON *echoes the query text* and contains *negative*
   fields (`"honeypot_with_same_creator":"0"`). Keyword regexes alone false-positive on both —
   so verdicts read named fields first (`is_honeypot`, `on_list`, `holders`, `verdict`),
   regexes only as a last resort. Every status is reproducible from the stored raw JSON.
3. **Epistemic honesty as a feature.** LLM fact-checkers cite stale lore (it flagged OpenAI
   over a fine that was **annulled in March 2026**). So the fact-check step verifies a
   present-tense legitimacy claim it cannot be stale on, and fresh enforcement news is the
   live WEB_SEARCH step's job. Each step does the check its source is *epistemically suited* for.
4. **Receipts are the product.** Every claim → `signal_hash` → free `GET /engine/v1/signal/{hash}`
   verification + on-chain settlement tx on Base Sepolia. The dashboard's receipt ledger browser
   lists every payment across every run with batch on-chain verification.

## Evidence (all on-chain, Base Sepolia)

| Artifact | What it proves |
|---|---|
| `evidence/first-call.json` | First paid call: `SANCTIONS_SCREENING_MATCH`, $0.01, epoch 441, tx `0xdeedd7a8…` |
| `evidence/legal-run-clean.json` | Legal dossier: **CLEAR**, 5/5 receipts, $0.05 |
| `evidence/exchange-run.json` | Exchange memo: **CLEAR**, 3/3 receipts (all direct specialists) |
| `evidence/stablecoin-run.json` | Compliance proof: **BLOCK** (fraud 75%), 4/4 receipts |
| Dashboard screenshots | `docs/screenshots/dash-top.png`, `dash-full.png` |

## Run it locally

```bash
npm install
npm run new-wallet          # generates burner key → .env.local (gitignored)
# fund it: https://faucet.circle.com  (20 testnet USDC / 2h / address, Base Sepolia)
npm run build && npm start  # → http://localhost:3000
```

Env: `TELEGRAPH_EVM_PRIVATE_KEY` (required), `TELEGRAPH_NODE_URL` (optional, defaults to
`https://devnode.telegraphprotocol.com`).

> Testnet only. Heuristic screening over machine-bought intelligence — not legal or
> compliance advice.
