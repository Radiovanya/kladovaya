import nodemailer from "nodemailer";
import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { buildPaymentQrPayload } from "@/lib/business";
import { getSession } from "@/lib/server/auth";
import type { PaymentSettings } from "@/lib/types";
import { isContractRecipient } from "@/lib/server/recipient";
import { hasTrustedOrigin, isValidEmail, readBoundedJson } from "@/lib/server/security";

export const runtime = "nodejs";

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  let body: {
    to?: string; customerName?: string; contractNumber?: string; periodLabel?: string;
    amountLabel?: string; amount?: number; purpose?: string; receiptEmail?: string;
    paymentDetails?: { recipientName?: string; taxId?: string; bankName?: string; bic?: string; accountNumber?: string; correspondentAccount?: string; kpp?: string };
  } | null;
  try {
    body = await readBoundedJson(request, 64 * 1024);
  } catch {
    return NextResponse.json({ error: "Слишком большой запрос" }, { status: 413 });
  }
  if (!body?.to || !body.contractNumber || !body.purpose || !body.amount || !body.paymentDetails) {
    return NextResponse.json({ error: "Недостаточно данных" }, { status: 400 });
  }
  if (!isValidEmail(body.to) || !(await isContractRecipient(body.contractNumber, body.to))) {
    return NextResponse.json({ error: "Получатель не совпадает с email клиента в договоре" }, { status: 400 });
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
  const settings: PaymentSettings = {
    bankName: body.paymentDetails.bankName ?? "",
    recipientName: body.paymentDetails.recipientName ?? "",
    taxId: body.paymentDetails.taxId ?? "",
    kpp: body.paymentDetails.kpp ?? "",
    accountNumber: body.paymentDetails.accountNumber ?? "",
    bic: body.paymentDetails.bic ?? "",
    correspondentAccount: body.paymentDetails.correspondentAccount ?? "",
    receiptEmail: body.receiptEmail ?? ""
  };
  let qrBuffer: Buffer;
  try {
    const payload = buildPaymentQrPayload(settings, body.amount, body.purpose);
    qrBuffer = await QRCode.toBuffer(payload, { width: 650, margin: 4, errorCorrectionLevel: "L", color: { dark: "#000000", light: "#ffffff" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сформировать банковский QR" }, { status: 400 });
  }

  const receiptText = body.receiptEmail
    ? `После оплаты отправьте чек на ${body.receiptEmail}. В теле письма укажите номер договора ${body.contractNumber} и период ${body.periodLabel}.`
    : "После оплаты сохраните чек.";
  const detailsText = `Получатель: ${settings.recipientName}\nИНН: ${settings.taxId}\nБанк: ${settings.bankName}\nБИК: ${settings.bic}\nРасчётный счёт: ${settings.accountNumber}\nКорреспондентский счёт: ${settings.correspondentAccount}`;
  const detailsHtml = `<p><b>Реквизиты для проверки:</b><br>Получатель: ${escapeHtml(settings.recipientName)}<br>ИНН: ${escapeHtml(settings.taxId)}<br>Банк: ${escapeHtml(settings.bankName)}<br>БИК: ${escapeHtml(settings.bic)}<br>Расчётный счёт: ${escapeHtml(settings.accountNumber)}<br>Корреспондентский счёт: ${escapeHtml(settings.correspondentAccount)}</p>`;
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: body.to,
    subject: `Оплата аренды · ${body.contractNumber} · ${body.periodLabel}`,
    text: `Здравствуйте, ${body.customerName}!\n\nСумма к оплате: ${body.amountLabel}\n${body.purpose}\n\n${detailsText}\n\n${receiptText}`,
    html: `<p>Здравствуйте, ${escapeHtml(body.customerName)}!</p><p><b>Сумма к оплате: ${escapeHtml(body.amountLabel)}</b></p><p>${escapeHtml(body.purpose)}</p><p><img src="cid:payment-qr" alt="QR-код для оплаты" width="325" height="325" style="display:block;width:325px;height:325px;max-width:100%;image-rendering:pixelated"></p><p><b>Если камера не распознаёт код:</b> откройте прикреплённый файл <b>qr-${escapeHtml(body.contractNumber)}-large.png</b> в полном размере либо сохраните его и выберите оплату по QR из галереи банковского приложения.</p>${detailsHtml}<p>${escapeHtml(receiptText)}</p>`,
    attachments: [
      { filename: `qr-${body.contractNumber}.png`, content: qrBuffer, cid: "payment-qr" },
      { filename: `qr-${body.contractNumber}-large.png`, content: qrBuffer, contentDisposition: "attachment" }
    ],
    disableFileAccess: true,
    disableUrlAccess: true
  });
  return NextResponse.json({ ok: true });
}
