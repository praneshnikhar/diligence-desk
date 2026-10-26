// Generates a burner wallet, writes .env.local (never committed), prints the address.
// The key persists across sessions so the on-chain evidence trail stays on ONE address.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const envFile = ".env.local";
if (existsSync(envFile)) {
  const cur = readFileSync(envFile, "utf8");
  if (cur.includes("TELEGRAPH_EVM_PRIVATE_KEY=0x") && !cur.includes("0x_your_key_here")) {
    const addr = privateKeyToAccount(cur.match(/TELEGRAPH_EVM_PRIVATE_KEY=0x[0-9a-fA-F]+/)?.[0]?.split("=")[1] ?? "0x00").address;
    console.log(`.env.local already has a key for ${addr} — keeping it (evidence continuity). Delete .env.local to rotate.`);
    process.exit(0);
  }
}

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);
writeFileSync(envFile, `TELEGRAPH_EVM_PRIVATE_KEY=${pk}\n`, { mode: 0o600 });
console.log("Burner wallet generated → .env.local (gitignored)");
console.log(`Address : ${account.address}`);
console.log(`Chain   : Base Sepolia (84532)`);
console.log("\nNEXT — fund it (free, no signup):");
console.log("  1. open https://faucet.circle.com");
console.log("  2. asset USDC · network Base Sepolia");
console.log(`  3. paste address ${account.address}`);
console.log("  4. claim 20 USDC (one request per wallet per 2 hours)");
console.log("\nThen: node scripts/smoke-test.mjs");
