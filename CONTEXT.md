# Diligence Desk — agent memory

> This file is the single source of truth for the whole project. Any agent (or me, next session)
> reads THIS FIRST before touching code. Update "Status" + "Next actions" at the end of every session.

## What we are building

A web app + agent for the **Telegraph Hackathon Season II** that takes one input and fires
several paid Telegraph requests in parallel, returning a signed diligence dossier with a cost line
and one receipt per claim.

- **Hackathon:** https://hackathon.telegraphprotocol.com · 1 Nov → 1 Dec 2026, 23:59 UTC
- **Track:** Apps & Agents (mission coverage: Legal primary → Exchange → Stablecoin)
- **Prize shape:** 8 delivery awards of $225 (set selection = "most distinct completed missions" FIRST) + excellence $700/$350/$150. Minimum 70/100 with ≥24/35 technical + a real autonomous purchase.
- **Nov 14 milestone:** show first working Telegraph purchase (progress check, not a deadline).

## Locked decisions

| Decision | Choice |
|---|---|
| Build | "Diligence Desk" — 5 parallel intents → one dossier |
| Missions | 04 Legal (primary) → 01 Exchange (stretch) → 02 Stablecoin (thin) |
| Stack | Next.js 15 + TypeScript, `@x402/fetch` + `@x402/evm`, deployment on Vercel free tier |
| Verdict logic | Deterministic keyword heuristics over raw miner output, labelled as a screening heuristic — no LLM in the loop |
| Budget | **$0 real money.** x402 exact only (no gas needed), testnet USDC from Circle faucet |
| Spending cap | $0.25 per run, 12 calls max, enforced in `lib/limits.ts` |
| Payments | x402 exact scheme → PayAI facilitator, aimed at `0x5a2324aA...8ff8` (Diamond, read fresh from 402 `accepts[].payTo` — never hardcode) |
| Repo | Private GitHub repo `praneshnikhar/diligence-desk` |
| Node version | v24 installed (needs ≥ 20; `@x402/*` uses WebCrypto) |

## The agent flow (Legal primary)

1. Input: company name (+ beneficial owner, optional).
2. Fire 5 paid requests in parallel (auto-routed `POST /engine/v1/ask`):

| Intent | miners | prompt |
|---|---|---|
| `CORPORATE_REGISTRY_LOOKUP` | 20 | Is `{company}` listed in national registries? status, jurisdiction, agent |
| `SANCTIONS_SCREENING_MATCH` | 14 | On OFAC/EU/UN lists? company + beneficial owner |
| `REGULATORY_FILING_MONITOR` | 15 | Recent statutory filings (10-K/10-Q/disclosures)? |
| `WEB_SEARCH` | 26 | Adverse news, litigation, red flags |
| `FACT_CHECK` | 18 | Are the company's own public claims true? |

   (live miner counts from `/engine/v1/intents` on 26 Oct 2026 — all ≥14, so no dead ends)
3. Capture `signal_hash`, `X-TELEGRAPH-RECEIPT`, `miner_name`, `cost_usd`, `duration_ms`, `intent` per call into the ledger.
4. Heuristic verdict CLEAR / REVIEW / BLOCK from the raw text.
5. Render dossier with a spend panel "N paid requests · N receipts · $0.0X · verified 0x…" — every claim clickable to its on-chain `signal_hash`.

**Exchange** adds: `SMART_CONTRACT_AUDIT`, `TOKEN_HOLDER_COUNT`, `SOCIAL_BOT_DETECTION`, `ONCHAIN_METRIC_VERIFY` (token contract address in, listing risk memo out).
**Stablecoin** reuses sanctions+registry and adds `FRAUD_RISK`, producing a **payment-attached compliance proof object** (the machine-readable Travel Rule thing).

## Status (updated 26 Oct 2026 — all 3 missions end-to-end)

- [x] Live testnet network verified: 134 canonical intents, every one ≥ 8 miners
- [x] Burner wallet funded (faucet.circle.com; **~$19.55 USDC left** — total demo spend ~$0.22)
- [x] First live paid x402 call → `evidence/first-call.json`
- [x] **Legal dossier end-to-end** → CLEAR, 5 receipts → **PR #8 merged**
- [x] **Exchange mission end-to-end** → CLEAR, 3 receipts (all direct specialists) → **PR #10 open**
- [x] **Stablecoin mission end-to-end** → BLOCK (fraud 75%), 4 receipts → **PR #10 open**
- [x] Direct-ask adapter architecture: free discovery → structured specialist asks → router fallback
- [x] PR #10 merged; PR #11 open (FACT_CHECK → FactWire direct adapter + stale-lore-safe claim)
- [ ] PR #11 merged ← awaiting user + Copilot review
- [ ] Deploy to Vercel + judge-facing README (issue #3)
- [ ] Nov 14 milestone evidence pack (issue #5)
- [ ] README + demo video + submission pack (due 1 Dec 23:59 UTC, issue #7)
- [ ] Known: ChainSight lacks USDC proof-of-reserves (reserve step = honest review); LLM fact-checkers
  can cite annulled/enforcement-obsolete history (mitigated: fact-check claims are present-tense
  legitimacy checks; fresh enforcement news is the WEB_SEARCH step's job)

## Next actions (in order)

1. **USER: review PR #11 with Copilot/CodeRabbit** → https://github.com/praneshnikhar/diligence-desk/pull/11 → merge (closes #9).
2. Deploy to Vercel (issue #3): hobby tier, `TELEGRAPH_EVM_PRIVATE_KEY` + `TELEGRAPH_NODE_URL` as env
   vars, then judge-facing README with evidence table + demo GIF.
3. UI polish: badge on each step showing `route: direct:slug` vs `router` (data already in ledger).
4. Nov 14 milestone evidence pack (issue #5): screenshots + receipt links + PDF export of a dossier.
5. Demo video + 5 commercial answers + submission (issue #7) — before 1 Dec 23:59 UTC.
6. Re-run flagship demo ON/AFTER Nov 1 — evidence from the event period matters for scoring.

## Session rules

- **PR workflow from now on** (user reviews each PR with Copilot before merge — do not push to main
  directly, do not close issues until after merge).
- End every session: update this Status + Next actions, commit, push to the PR branch.

## Gotchas (learned or verified today)

- `@x402/*` needs Node ≥ 20 (`Crypto API not available` on 18) — we're on 24, fine.
- x402 `exact` scheme: the **PayAI facilitator submits the transfer**, payer signs an EIP-3009
  authorization → **no Base Sepolia ETH needed**. Escrow / ERC-8183 rails DO need gas — avoid.
- x402 v2 (2.28) client API: `new x402Client().register("eip155:84532", new ExactEvmScheme(toClientEvmSigner(account)))`
  — pass the viem **LocalAccount** directly; a WalletClient lacks `.address` and breaks payload building.
- **Direct miner-ask protocol**: `POST /engine/v1/ask/{minerId}` with `{query, method, endpoint, payload}` —
  a bare `{query}` 400s (`AskSubnetRequest.Method required`). 400/404 = free. Payload schemas come from
  the free `/api/miners` discovery (`input_schema`, `endpoints`). Schemas are per-miner, sometimes wrong
  (ChainSight /supply wants `symbol`, not `address`) — verify by probing, 400s cost nothing.
- Failed calls are **not charged** (settle only on 2xx). Discovery endpoints are free:
  `GET /api/miners`, `GET /engine/v1/intents`, `GET /engine/v1/intents/{intent}/miners`, `GET /engine/v1/signal/{hash}`.
- The LLM router misroutes generic-word intents ("audit" → academic papers). Never route what you can
  pin; the router is the fallback, not the plan.
- Miner outputs echo query text into JSON — keyword regexes false-positive on our own prompts and on
  NEGATIVE fields (`"honeypot_with_same_creator":"0"`). Decide on structure first, regex second.
- The engine reflects current list reality: Tornado Cash → `on_list: 0` (delisted Mar 2025) while the
  fraud miner still flags mixer payments. Fresh lists beat stale lore — a demo strength.
- Miner quality varies; always surface raw excerpts + reasoning next to the verdict for human review.
- Resource URL inside a 402 body omits the `/engine` prefix — always retry the URL YOU requested.

## Pointers

- Local project: `/Users/pranesh/coding2/diligence-desk` (git repo now; private GitHub repo)
- `.env.local` (gitignored): `TELEGRAPH_EVM_PRIVATE_KEY` — **kept constant across sessions** so
  the on-chain evidence trail stays on ONE judge-verifiable address.
- Hackathon docs: docs.telegraphprotocol.com (pages support `.md` tail)
- Engine: `https://devnode.telegraphprotocol.com/engine` (v1/ask, v1/signal/{hash})
- Rules (competition): hackathon.telegraphprotocol.com/rules

## Submission checklist (due 1 Dec 23:59 UTC)

- [ ] Project details (team, track, missions) + reviewer-access link
- [ ] 2–5 min demo video: input → Telegraph request → evidence → cost line → result → how to try
- [ ] How to run (prereqs, `.env`, sample input, expected result, exact network, spend limits, known limits)
- [ ] Evidence: receipts, signal hashes, ledger JSON
- [ ] 5 commercial-summary answers (for whom / what improves / what today / why adopt / how to try)
- [ ] Showcase permission selection
