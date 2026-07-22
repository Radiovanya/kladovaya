import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Prisma } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findContractNumber, findPaymentPeriod } from "@/lib/receipt-email";
import { assertS3Configured, documentsBucket, s3 } from "@/lib/server/s3";
import type { AppData, Charge, DocumentItem, Payment, Task } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const nextId = (items: Array<{ id: number }>) => Math.max(0, ...items.map((item) => item.id)) + 1;
const pad = (value: number) => String(value).padStart(2, "0");

function monthDates(period: string, billingDay: number) {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${period}-01`,
    end: `${period}-${pad(lastDay)}`,
    due: `${period}-${pad(Math.min(Math.max(Math.trunc(billingDay || 1), 1), lastDay))}`
  };
}

function manualTask(data: AppData, title: string, description: string) {
  if (data.tasks.some((task) => task.description.includes(description))) return;
  data.tasks.push({
    id: nextId(data.tasks), title, description, dueDate: new Date().toISOString().slice(0, 16),
    priority: "high", status: "open", relatedEntityType: null, relatedEntityId: null
  } satisfies Task);
}

export async function POST(request: Request) {
  const secret = process.env.RECEIPT_CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASSWORD) {
    return NextResponse.json({ error: "IMAP не настроен" }, { status: 503 });
  }
  assertS3Configured();
  const state = await prisma.appState.findUnique({ where: { id: 1 } });
  if (!state) return NextResponse.json({ error: "Данные приложения не найдены" }, { status: 503 });
  const data = structuredClone(state.payload) as unknown as AppData;
  data.paymentRequests ??= [];
  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: String(process.env.IMAP_SECURE ?? "true") === "true",
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
    logger: false
  });
  let processed = 0;
  let matched = 0;
  let changed = false;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const unseen = await client.search({ seen: false }, { uid: true });
      for (const uid of unseen || []) {
        const message = await client.fetchOne(String(uid), { uid: true, source: { maxLength: 15 * 1024 * 1024 }, envelope: true }, { uid: true });
        if (!message || !message.source) continue;
        const parsed = await simpleParser(message.source);
        const text = `${parsed.subject ?? ""}\n${parsed.text ?? ""}\n${typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : ""}`;
        const messageKey = createHash("sha256").update(parsed.messageId || `${uid}:${parsed.date?.toISOString() ?? ""}:${parsed.subject ?? ""}`).digest("hex").slice(0, 20);
        const referenceNumber = `EMAIL-${messageKey}`;
        if (data.payments.some((payment) => payment.referenceNumber === referenceNumber || payment.comment.includes(referenceNumber))) {
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          continue;
        }
        const contractNumber = findContractNumber(text, data.contracts.map((item) => item.contractNumber));
        const period = findPaymentPeriod(text);
        const attachments = parsed.attachments.filter((attachment) =>
          allowedTypes.has(attachment.contentType) && attachment.content.length <= 10 * 1024 * 1024
        );
        processed += 1;
        if (!contractNumber || !period || attachments.length === 0) {
          manualTask(data, "Проверить входящий чек", `Письмо ${referenceNumber}: ${!contractNumber ? "не найден договор; " : ""}${!period ? "не найден период; " : ""}${attachments.length === 0 ? "нет PDF/JPG/PNG/WebP вложения" : ""}`);
          changed = true;
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          continue;
        }
        const contract = data.contracts.find((item) => item.contractNumber === contractNumber)!;
        const customer = data.customers.find((item) => item.id === contract.customerId)!;
        let charge = data.charges.find((item) => item.contractId === contract.id && item.periodStart.slice(0, 7) === period);
        if (!charge) {
          const dates = monthDates(period, contract.billingDay);
          charge = {
            id: nextId(data.charges), contractId: contract.id, periodStart: dates.start, periodEnd: dates.end,
            dueDate: dates.due, amount: contract.monthlyRate, chargeType: "rent", status: "pending",
            note: "Создано автоматически по чеку из почты"
          } satisfies Charge;
          data.charges.push(charge);
        }
        const linkedPayments = data.payments.filter((item) => item.chargeId === charge!.id);
        const paidAmount = linkedPayments.reduce((sum, item) => sum + item.amount, 0);
        const outstanding = Math.max(0, charge.amount - paidAmount);
        let payment = linkedPayments.at(-1);
        if (!payment || outstanding > 0) {
          payment = {
            id: nextId(data.payments), customerId: customer.id, contractId: contract.id, chargeId: charge.id,
            paymentDate: (parsed.date ?? new Date()).toISOString().slice(0, 10), amount: outstanding || charge.amount,
            paymentMethod: "bank_transfer", referenceNumber,
            comment: `Автоматически из письма за ${period}; отправитель: ${parsed.from?.text ?? "не указан"}`
          } satisfies Payment;
          data.payments.push(payment);
        } else {
          payment.comment = `${payment.comment}${payment.comment ? "; " : ""}чек ${referenceNumber}`;
        }
        charge.status = "paid";
        const requestItem = [...data.paymentRequests].reverse().find((item) => item.contractId === contract.id && item.period === period);
        if (requestItem) requestItem.status = "paid";
        const task = data.tasks.find((item) => item.relatedEntityType === "contract_payment" && item.relatedEntityId === contract.id && item.paymentPeriod === period);
        if (task) task.status = "paid";
        for (const attachment of attachments) {
          const safeName = (attachment.filename ?? "receipt").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "receipt";
          const key = `receipts/${contract.id}/${period}/${randomUUID()}-${safeName}`;
          await s3.send(new PutObjectCommand({ Bucket: documentsBucket, Key: key, Body: attachment.content, ContentType: attachment.contentType }));
          data.documents.push({
            id: nextId(data.documents), entityType: "payment", entityId: payment.id,
            fileName: attachment.filename ?? `receipt-${period}`, fileUrl: `/api/documents?key=${encodeURIComponent(key)}`,
            documentType: "receipt", mimeType: attachment.contentType, fileSize: attachment.size,
            uploadedAt: new Date().toISOString()
          } satisfies DocumentItem);
        }
        matched += 1;
        changed = true;
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
      }
    } finally {
      lock.release();
    }
  } finally {
    if (client.usable) await client.logout().catch(() => client.close());
  }
  if (changed) {
    await prisma.appState.update({
      where: { id: 1 }, data: { payload: data as unknown as Prisma.InputJsonValue, version: { increment: 1 } }
    });
  }
  return NextResponse.json({ ok: true, processed, matched });
}
