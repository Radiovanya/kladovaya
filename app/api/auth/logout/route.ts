import { NextResponse } from "next/server";
import { clearSession } from "@/lib/server/auth";
import { hasTrustedOrigin } from "@/lib/server/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  await clearSession();
  return NextResponse.json({ ok: true });
}
