import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Prisma } from "@prisma/client";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { findContractNumber, findPaymentPeriod } from "@/lib/receipt-email";
import { assertS3Configured, documentsBucket, s3 } from "@/lib/server/s3";
import { secureEqual } from "@/lib/server/security";
import type { AppData, DocumentItem, Task } from "@/lib/types";
import { encryptDocument } from "@/lib/server/document-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const nextId = (items: Array<{ id: number }>) => Math.max(0, ...items.map((item) => item.id)) + 1;
function manualTask(data: AppData, title: string, description: string, contractId?: number, period?: string) {
  if (data.tasks.some((task) => task.description.includes(description))) return;
  data.tasks.push({
    id: nextId(data.tasks), title, description, dueDate: new Date().toISOString().slice(0, 16),
    priority: "high", status: "open", relatedEntityType: contractId ? "contract_payment" : null,
    relatedEntityId: contractId ?? null, paymentPeriod: period
  } satisfies Task);
}

function detectedMime(content: Buffer) {
  if (content.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return "image/jpeg";
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.RECEIPT_CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (!secret || !secureEqual(authorization, `Bearer ${secret}`)) {
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
        if (data.payments.some((payment) => payment.referenceNumber === referenceNumber || payment.comment.includes(referenceNumber))
          || data.tasks.some((task) => task.description.includes(referenceNumber))) {
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          continue;
        }
        const contractNumber = findContractNumber(text, data.contracts.map((item) => item.contractNumber));
        const period = findPaymentPeriod(text);
        const attachments = parsed.attachments.map((attachment) => ({ attachment, mimeType: detectedMime(attachment.content) }))
          .filter(({ attachment, mimeType }) => mimeType && allowedTypes.has(mimeType) && mimeType === attachment.contentType && attachment.content.length <= 10 * 1024 * 1024);
        processed += 1;
        if (!contractNumber || !period || attachments.length === 0) {
          manualTask(data, "Проверить входящий чек", `Письмо ${referenceNumber}: ${!contractNumber ? "не найден договор; " : ""}${!period ? "не найден период; " : ""}${attachments.length === 0 ? "нет PDF/JPG/PNG/WebP вложения" : ""}`);
          changed = true;
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          continue;
        }
        const contract = data.contracts.find((item) => item.contractNumber === contractNumber)!;
        const customer = data.customers.find((item) => item.id === contract.customerId)!;
        const sender = parsed.from?.value[0]?.address?.trim().toLowerCase() ?? "";
        if (!customer || !sender || sender !== customer.email.trim().toLowerCase()) {
          manualTask(data, "Проверить отправителя чека", `Письмо ${referenceNumber}: отправитель ${sender || "не указан"} не совпадает с email клиента договора ${contractNumber}`, contract.id, period);
          changed = true;
          await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
          continue;
        }
        for (const { attachment, mimeType } of attachments) {
          const safeName = (attachment.filename ?? "receipt").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "receipt";
          const key = `receipts/${contract.id}/${period}/${randomUUID()}-${safeName}`;
          const encrypted = encryptDocument(attachment.content, mimeType!);
          await s3.send(new PutObjectCommand({
            Bucket: documentsBucket, Key: key, Body: encrypted.body, ContentType: "application/octet-stream",
            Metadata: { originalname: encodeURIComponent((attachment.filename ?? "receipt").slice(0, 200)), ...encrypted.metadata }
          }));
          data.documents.push({
            id: nextId(data.documents), entityType: "contract", entityId: contract.id,
            fileName: attachment.filename ?? `receipt-${period}`, fileUrl: `/api/documents?key=${encodeURIComponent(key)}`,
            documentType: "receipt", mimeType: mimeType!, fileSize: attachment.size,
            uploadedAt: new Date().toISOString()
          } satisfies DocumentItem);
        }
        manualTask(
          data,
          `Подтвердить оплату · ${contractNumber} · ${period}`,
          `Письмо ${referenceNumber}: чек получен от ${sender}. Проверьте сумму и поступление в банке, затем внесите оплату вручную.`,
          contract.id,
          period
        );
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
