// One real PAID call through Telegraph, capturing the evidence that judges verify.
// Saves evidence/first-call.json. If it prints a signal_hash + receipt, the whole hackathon is unlocked.
import { readFile, mkdir, writeFile } from "node:fs/promises";

const ENGINE = process.env.TELEGRAPH_ENGINE_URL ?? "https://devnode.telegraphprotocol.com/engine";

// 1. env
let key;
try {
  key = (await readFile(".env.local", "utf8")).match(/TELEGRAPH_EVM_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
} catch {}
if (!key) {
  console.error("No TELEGRAPH_EVM_PRIVATE_KEY in .env.local — run `npm run new-wallet` first");
  process.exit(1);
}

// 2. free reachability check on the node
const health = await fetch("https://devnode.telegraphprotocol.com/status").then((r) => r.json()).catch(() => null);
console.log("node reachable:", health ? "yes" : "NO — check network/proxy");
if (!health) process.exit(1);

// 3. the paid call — a real Legal-mission query (cheap, judgement-type intent)
const query = 'Screen the company "OpenAI" against OFAC SDN, EU consolidated and UN consolidated financial sanctions lists. Report exact and fuzzy matches with scores and sources. If there are no hits say so explicitly.';
console.log("\nquery :", query.slice(0, 80) + "…");

const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");
const { ExactEvmScheme, toClientEvmSigner } = await import("@x402/evm");
const { privateKeyToAccount } = await import("viem/accounts");
const account = privateKeyToAccount(key);
const evmSigner = toClientEvmSigner(account);
const x402 = new x402Client().register("eip155:84532", new ExactEvmScheme(evmSigner));
const fetchWithPayment = wrapFetchWithPayment(fetch, x402);

const res = await fetchWithPayment(`${ENGINE}/v1/ask`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});

const receiptB64 = res.headers.get("x-telegraph-receipt");
const receipt = receiptB64 ? JSON.parse(Buffer.from(receiptB64, "base64").toString("utf8")) : null;
const text = await res.text();
let data = null;
try { data = JSON.parse(text); } catch {}

console.log("\n=== RESULT ===");
console.log("http status :", res.status);
console.log("intent      :", data?.intent ?? "(none)");
console.log("miner       :", data?.miner_name ?? "(none)");
console.log("cost_usd    :", data?.cost_usd ?? "(none)");
console.log("signal_hash :", data?.signal_hash ?? "(none)");
if (receipt) console.log("receipt     :", JSON.stringify(receipt, null, 1));
console.log("result      :", text.slice(0, 400) + (text.length > 400 ? "…" : ""));

await mkdir("evidence", { recursive: true });
await writeFile("evidence/first-call.json", JSON.stringify({ query, status: res.status, data, receipt, capturedAt: new Date().toISOString() }, null, 2));
console.log("\nevidence/first-call.json saved");
if (data?.signal_hash && receipt) console.log("✓ PAID CALL COMPLETE — hackathon unlocked");
else if (res.status === 402) console.log("✗ payment did not settle — likely an empty wallet: fund at faucet.circle.com");
