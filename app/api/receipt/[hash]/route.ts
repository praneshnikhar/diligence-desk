import { NextRequest, NextResponse } from "next/server";
import { lookupSignal } from "@/lib/telegraph";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!/^0x[a-fA-F0-9]+$/.test(hash)) {
    return NextResponse.json({ error: "Bad hash" }, { status: 400 });
  }
  const { exists, signal } = await lookupSignal(hash);
  return NextResponse.json({ exists, signal, verifiedAt: new Date().toISOString() });
}
