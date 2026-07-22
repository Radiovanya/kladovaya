import nodemailer from "nodemailer";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";

export const runtime = "nodejs";

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function simpleHtml(markdown: string) {
  return markdown.split("\n").map((line) => {
    const safe = escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const heading = safe.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
    if (/^---+$/.test(line.trim())) return "<hr>";
    return safe.trim() ? `<p>${safe}</p>` : "";
  }).join("\n");
}

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
  const htmlDocument = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${escapeHtml(body.contractNumber)}</title><style>body{font-family:Arial,sans-serif;max-width:820px;margin:36px auto;line-height:1.45;font-size:12px;color:#111}h1{text-align:center;font-size:22px}h2{font-size:16px;margin-top:24px}p{margin:6px 0}@media print{@page{size:A4;margin:18mm}body{margin:0;max-width:none}}</style></head><body>${simpleHtml(body.content)}</body></html>`;
  await transport.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: body.to,
    subject: `Договор аренды ${body.contractNumber}`,
    text: `Здравствуйте, ${body.customerName ?? ""}!\n\nНаправляем сформированный договор аренды ${body.contractNumber}. Документ приложен к письму.`,
    html: `<p>Здравствуйте, ${escapeHtml(body.customerName ?? "")}!</p><p>Направляем сформированный договор аренды <b>${escapeHtml(body.contractNumber)}</b>. Документ приложен к письму.</p>`,
    attachments: [
      { filename: `dogovor-${body.contractNumber}.html`, content: Buffer.from(htmlDocument), contentType: "text/html; charset=utf-8" },
      { filename: `dogovor-${body.contractNumber}.md`, content: Buffer.from(body.content), contentType: "text/markdown; charset=utf-8" }
    ]
  });
  return NextResponse.json({ ok: true });
}
