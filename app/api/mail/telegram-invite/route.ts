import nodemailer from "nodemailer";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";
import { isContractRecipient } from "@/lib/server/recipient";
import { hasTrustedOrigin, isValidEmail, readBoundedJson } from "@/lib/server/security";

export const runtime = "nodejs";

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });

  let body: {
    to?: string;
    customerName?: string;
    contractNumber?: string;
    inviteUrl?: string;
    expiresAt?: string;
  } | null;
  try {
    body = await readBoundedJson(request, 16 * 1024);
  } catch {
    return NextResponse.json({ error: "Слишком большой запрос" }, { status: 413 });
  }

  if (!body?.to || !body.contractNumber || !body.inviteUrl) {
    return NextResponse.json({ error: "Недостаточно данных" }, { status: 400 });
  }
  if (!isValidEmail(body.to) || !(await isContractRecipient(body.contractNumber, body.to))) {
    return NextResponse.json({ error: "Получатель не совпадает с email клиента в договоре" }, { status: 400 });
  }

  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  let inviteUrl: URL;
  try {
    inviteUrl = new URL(body.inviteUrl);
  } catch {
    return NextResponse.json({ error: "Некорректная ссылка Telegram" }, { status: 400 });
  }
  if (
    !botUsername ||
    inviteUrl.protocol !== "https:" ||
    inviteUrl.hostname !== "t.me" ||
    inviteUrl.pathname !== `/${botUsername}` ||
    !/^[A-Za-z0-9_-]{20,64}$/.test(inviteUrl.searchParams.get("start") ?? "")
  ) {
    return NextResponse.json({ error: "Некорректная ссылка Telegram" }, { status: 400 });
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    return NextResponse.json({ error: "Почтовый ящик ещё не подключён" }, { status: 503 });
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: String(process.env.SMTP_SECURE ?? "true") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
  const expiry = body.expiresAt
    ? new Intl.DateTimeFormat("ru-RU").format(new Date(body.expiresAt))
    : "в течение 7 дней";
  const customerName = body.customerName?.trim() || "арендатор";

  await transport.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: body.to,
    subject: `Подключение уведомлений об оплате · ${body.contractNumber}`,
    text: `Здравствуйте, ${customerName}!\n\nПодключите Telegram-бота для получения уведомлений об оплате по договору ${body.contractNumber}:\n${inviteUrl.toString()}\n\nСсылка одноразовая и действует до ${expiry}.`,
    html: `<p>Здравствуйте, ${escapeHtml(customerName)}!</p><p>Подключите Telegram-бота для получения уведомлений об оплате по договору <b>${escapeHtml(body.contractNumber)}</b>.</p><p><a href="${escapeHtml(inviteUrl.toString())}" style="display:inline-block;padding:12px 18px;background:#203325;color:#fff;text-decoration:none;border-radius:8px">Подключить Telegram</a></p><p>Ссылка одноразовая и действует до ${escapeHtml(expiry)}.</p>`,
    disableFileAccess: true,
    disableUrlAccess: true
  });

  return NextResponse.json({ ok: true });
}
