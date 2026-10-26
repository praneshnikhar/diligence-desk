import { readFile } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";

const key = (await readFile(".env.local", "utf8")).match(/TELEGRAPH_EVM_PRIVATE_KEY=(0x[0-9a-fA-F]+)/)?.[1];
if (!key) { console.error("no key in .env.local"); process.exit(1); }
const account = privateKeyToAccount(key);
console.log("derived from .env.local key →", account.address);
console.log("key fingerprint (safe to show) :", key.slice(0, 8) + "…", "| length", key.length, "chars | never printed in full");
