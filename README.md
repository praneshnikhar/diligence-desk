# Diligence Desk

Telegraph Hackathon Season II — Apps & Agents track · missions: **04 Legal** (primary), **01 Exchange**, **02 Stablecoin**

Paste a company name (+ optional beneficial owner) → the agent fires 5 paid Telegraph requests
in parallel and returns a **signed diligence dossier** with one receipt per claim and a cost line
at the bottom. Every claim is verifiable on-chain via its `signal_hash`.

One engine, three surfaces:

| Mission | Input | Output |
|---|---|---|
| **Legal** | company + owner | 5-jurisdiction diligence pack |
| **Exchange** | token contract | listing risk memo |
| **Stablecoin** | payee + amount | compliance proof attached to a payment |

## Quick start

```bash
npm install
npm run new-wallet           # generates .env.local with a burner key
# → open https://faucet.circle.com, select Base Sepolia, paste the printed address, claim 20 USDC
node scripts/smoke-test.mjs  # one real paid call, saves evidence/first-call.json
npm run dev                  # http://localhost:3000
```

## Configuration

`.env.local` (see `.env.example`):

| Var | Required | Notes |
|---|---|---|
| `TELEGRAPH_EVM_PRIVATE_KEY` | yes | Burner wallet. Testnet only. Never commit. |
| `TELEGRAPH_NODE_URL` | no | defaults `https://devnode.telegraphprotocol.com` |

## Spending limits

- `MAX_CALLS_PER_RUN = 12`
- `MAX_SPEND_PER_RUN = $0.25`
- enforced server-side (`lib/limits.ts`); per-run ledger caps before dispatch.

## Networks

- Base Sepolia (testnet, chain 84532). USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Inference cost: ~$0.01 USDC of testnet money per call. **No real money moves.**

## Known limitations

- Miner routing is LLM-classified — the app verifies the returned `intent` per call.
- Verdicts are keyword heuristics over raw miner output — a screening aid, not legal advice.
- Runs on testnet; some mainnet-flavoured features (escrow settlement, on-chain jobs) are out of scope.
