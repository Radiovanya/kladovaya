import nodemailer from "nodemailer";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";
import { createContractPdf } from "@/lib/server/contract-pdf";

export const runtime = "nodejs";

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as {
    to?: string; customerName?: string; contractNumber?: string; content?: string;
  } | null;
  if (!body?.to || !body.contractNumber || !body.content) {
    return NextResponse.json({ error: "Недостаточно данных" }, { status: 400 });
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
  const pdf = await createContractPdf(body.content);
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: body.to,
    subject: `Договор аренды ${body.contractNumber}`,
    text: `Здравствуйте, ${body.customerName ?? ""}!\n\nНаправляем сформированный договор аренды ${body.contractNumber}. Документ приложен к письму.`,
    html: `<p>Здравствуйте, ${escapeHtml(body.customerName ?? "")}!</p><p>Направляем сформированный договор аренды <b>${escapeHtml(body.contractNumber)}</b>. Документ приложен к письму.</p>`,
    attachments: [{ filename: `Договор-${body.contractNumber}.pdf`, content: pdf, contentType: "application/pdf" }]
  });
  return NextResponse.json({ ok: true });
}
