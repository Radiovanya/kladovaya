import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/server/auth";
import { hasTrustedOrigin, readBoundedJson } from "@/lib/server/security";
import { seedData } from "@/lib/seed";
import type { AppData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validAppData(value: unknown): value is AppData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["locations", "units", "customers", "contracts", "charges", "payments", "tasks", "documents", "users"]
    .every((key) => Array.isArray(record[key]));
}

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const state = await prisma.appState.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, payload: seedData as unknown as Prisma.InputJsonValue }
  });
  return NextResponse.json({ data: state.payload, version: state.version }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  let body: { data?: unknown } | null;
  try {
    body = await readBoundedJson(request, 2 * 1024 * 1024);
  } catch {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  if (!validAppData(body?.data)) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });

  const state = await prisma.appState.upsert({
    where: { id: 1 },
    update: { payload: body.data as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    create: { id: 1, payload: body.data as unknown as Prisma.InputJsonValue }
  });
  return NextResponse.json({ ok: true, version: state.version });
}
