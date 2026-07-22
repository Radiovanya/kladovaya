import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSession();
  return user
    ? NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
