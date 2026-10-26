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

## Status (updated 26 Oct 2026)

- [x] Live testnet network verified: 134 canonical intents, every one ≥ 8 miners (CRYPTO_PRICE 56, WEB_SEARCH 26 …)
- [x] Full 15-mission data parsed from the hackathon site JS to pick the mission cluster
- [x] Stack/cost/mission decisions locked
- [x] `package.json` + npm install (next 15, react 19, @x402/*, viem, tsx types)
- [ ] Burner wallet generated + funded (Circle faucet, 20 USDC/2h/addr)
- [ ] **First live paid x402 call → capture a real `signal_hash`** ← next critical action
- [ ] Legal dossier end-to-end + deployed to Vercel
- [ ] Exchange stretch mission
- [ ] Stablecoin stretch mission
- [ ] README + demo video + submission pack (due 1 Dec 23:59 UTC)

## Next actions (in order)

1. `npm run new-wallet` → copy `TELEGRAPH_EVM_PRIVATE_KEY` into `.env.local` (gitignored).
2. **GO TO** https://faucet.circle.com → paste the burner address → 20 USDC on **Base Sepolia**. (User step — reCAPTCHA. ~5 min.)
3. `node scripts/smoke-test.mjs` → fires ONE real paid call and saves `signal_hash` + `X-TELEGRAPH-RECEIPT` to `evidence/first-call.json`. This is THE moment — after it works, everything else is plumbing.
4. `npm run dev` → Legal dossier end-to-end, verify receipts render.
5. Deploy to Vercel, then start the Exchange mission.

## Gotchas (learned or verified today)

- `@x402/*` needs Node ≥ 20 (`Crypto API not available` on 18) — we're on 24, fine.
- x402 `exact` scheme: the **PayAI facilitator submits the transfer**, payer signs an EIP-3009
  authorization → **no Base Sepolia ETH needed**. Escrow / ERC-8183 rails DO need gas — avoid.
- Failed calls are **not charged** (settle only on 2xx). Discovery endpoints are free:
  `GET /api/miners`, `GET /engine/v1/intents`, `GET /engine/v1/signal/{hash}`.
- Auto-route may misclassify the intent → always check the returned `intent` field; re-phrase or
  fall back to direct `POST /engine/v1/ask/{minerId}` if wrong. Never trust hard-coded miner IDs.
- `resource.url` inside a 402 body omits the `/engine` prefix — always retry the URL YOU requested.
- Most intents have 0 results from LLM parsing — the raw `result` block is what we render. There is
  no `parsed` field for judgment-type intents, only `result`.
- The x402 pricing the 402 challenge quotes may be above the floor multiplier (demand pricing). Cap the per-run spend regardless.

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
