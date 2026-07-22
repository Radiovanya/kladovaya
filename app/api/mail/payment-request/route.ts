import nodemailer from "nodemailer";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as {
    to?: string; customerName?: string; contractNumber?: string; periodLabel?: string;
    amountLabel?: string; purpose?: string; receiptEmail?: string; qrDataUrl?: string;
  } | null;
  if (!body?.to || !body.contractNumber || !body.qrDataUrl) return NextResponse.json({ error: "Недостаточно данных" }, { status: 400 });
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    return NextResponse.json({ error: "Почтовый ящик ещё не подключён" }, { status: 503 });
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: String(process.env.SMTP_SECURE ?? "true") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
  const receiptText = body.receiptEmail
    ? `После оплаты отправьте чек на ${body.receiptEmail}. В теле письма укажите номер договора ${body.contractNumber} и период ${body.periodLabel}.`
    : "После оплаты сохраните чек.";
  const qrBase64 = body.qrDataUrl.split(",")[1];
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: body.to,
    subject: `Оплата аренды · ${body.contractNumber} · ${body.periodLabel}`,
    text: `Здравствуйте, ${body.customerName}!\n\nСумма к оплате: ${body.amountLabel}\n${body.purpose}\n\n${receiptText}`,
    html: `<p>Здравствуйте, ${body.customerName}!</p><p><b>Сумма к оплате: ${body.amountLabel}</b></p><p>${body.purpose}</p><p><img src="cid:payment-qr" alt="QR-код для оплаты" width="260" height="260"></p><p>${receiptText}</p>`,
    attachments: qrBase64 ? [{ filename: `qr-${body.contractNumber}.png`, content: Buffer.from(qrBase64, "base64"), cid: "payment-qr" }] : []
  });
  return NextResponse.json({ ok: true });
}
