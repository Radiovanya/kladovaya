import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/server/auth";
import { clearLoginFailures, hasTrustedOrigin, loginRateLimit, readBoundedJson, recordLoginFailure } from "@/lib/server/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const rate = loginRateLimit(request);
  if (!rate.allowed) {
    return NextResponse.json({ error: "Слишком много попыток. Повторите позже" }, {
      status: 429, headers: { "Retry-After": String(rate.retryAfter), "Cache-Control": "no-store" }
    });
  }
  let body: { email?: string; password?: string } | null;
  try {
    body = await readBoundedJson(request, 4 * 1024);
  } catch {
    return NextResponse.json({ error: "Слишком большой запрос" }, { status: 413 });
  }
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!configuredEmail || !passwordHash) {
    return NextResponse.json({ error: "Вход ещё не настроен" }, { status: 503 });
  }
  const passwordMatches = password.length <= 1024 && await bcrypt.compare(password, passwordHash);
  if (email !== configuredEmail || !passwordMatches) {
    recordLoginFailure(rate.key);
    return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
  }

  clearLoginFailures(rate.key);
  const user = { email: configuredEmail, name: process.env.ADMIN_NAME ?? "Администратор", role: "Admin" as const };
  await createSession(user);
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
}
