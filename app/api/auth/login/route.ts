import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createSession } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const configuredEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!configuredEmail || !passwordHash) {
    return NextResponse.json({ error: "Вход ещё не настроен" }, { status: 503 });
  }
  if (email !== configuredEmail || !(await bcrypt.compare(password, passwordHash))) {
    return NextResponse.json({ error: "Неверный email или пароль" }, { status: 401 });
  }

  const user = { email: configuredEmail, name: process.env.ADMIN_NAME ?? "Администратор", role: "Admin" as const };
  await createSession(user);
  return NextResponse.json({ user });
}
