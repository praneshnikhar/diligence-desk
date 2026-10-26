import { NextResponse } from "next/server";
import { createPublicClient, http, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export async function GET() {
  const key = process.env.TELEGRAPH_EVM_PRIVATE_KEY;
  if (!key) return NextResponse.json({ error: "No key configured" }, { status: 200 });
  let address: string;
  try {
    address = privateKeyToAccount(key as `0x${string}`).address;
  } catch {
    return NextResponse.json({ error: "Key malformed" }, { status: 200 });
  }
  const client = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
  let usdc: string | null = null;
  let eth: string | null = null;
  try {
    const bal = await client.readContract({
      address: USDC,
      abi: ABI,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });
    usdc = formatUnits(bal, 6);
  } catch {
    usdc = null;
  }
  try {
    const b = await client.getBalance({ address: address as `0x${string}` });
    eth = formatUnits(b, 18);
  } catch {
    eth = null;
  }
  return NextResponse.json({
    address,
    usdc,
    eth,
    network: "Base Sepolia (84532)",
    explorer: `https://sepolia.basescan.org/address/${address}`,
  });
}
