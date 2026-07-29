import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/server/auth";
import { hasTrustedOrigin, readBoundedJson } from "@/lib/server/security";
import type { AppData, TelegramInvite } from "@/lib/types";

export const runtime = "nodejs";

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  let body: { customerId?: number; contractId?: number } | null;
  try {
    body = await readBoundedJson(request, 16 * 1024);
  } catch {
    return NextResponse.json({ error: "Слишком большой запрос" }, { status: 413 });
  }
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (!botUsername) return NextResponse.json({ error: "Telegram-бот ещё не подключён" }, { status: 503 });
  const state = await prisma.appState.findUnique({ where: { id: 1 } });
  if (!state) return NextResponse.json({ error: "Данные приложения не найдены" }, { status: 503 });
  const data = structuredClone(state.payload) as unknown as AppData;
  const contract = data.contracts.find((item) => item.id === Number(body?.contractId));
  if (!contract || contract.customerId !== Number(body?.customerId)) {
    return NextResponse.json({ error: "Договор клиента не найден" }, { status: 404 });
  }
  const token = randomBytes(24).toString("base64url");
  const now = new Date();
  const expires = new Date(now);
  expires.setDate(expires.getDate() + 7);
  data.telegramInvites ??= [];
  data.telegramInvites = data.telegramInvites.filter((invite) =>
    invite.contractId !== contract.id || Boolean(invite.usedAt) || new Date(invite.expiresAt) <= now
  );
  data.telegramInvites.push({
    id: Math.max(0, ...data.telegramInvites.map((item) => item.id)) + 1,
    customerId: contract.customerId,
    contractId: contract.id,
    tokenHash: tokenHash(token),
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString()
  } satisfies TelegramInvite);
  await prisma.appState.update({
    where: { id: 1 },
    data: { payload: data as unknown as Prisma.InputJsonValue, version: { increment: 1 } }
  });
  return NextResponse.json({
    url: `https://t.me/${botUsername}?start=${token}`,
    expiresAt: expires.toISOString()
  });
}
