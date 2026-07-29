import { PutObjectCommand } from "@aws-sdk/client-s3";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { currentPaymentPeriod } from "@/lib/business";
import { prisma } from "@/lib/prisma";
import { encryptDocument } from "@/lib/server/document-crypto";
import { assertS3Configured, documentsBucket, s3 } from "@/lib/server/s3";
import { secureEqual } from "@/lib/server/security";
import { answerTelegramCallback, downloadTelegramFile, sendTelegramMessage } from "@/lib/server/telegram";
import type { AppData, DocumentItem, Task, TelegramBinding } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type TelegramFile = { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number; text?: string; caption?: string;
    chat: { id: number; type: string; username?: string };
    from?: { username?: string };
    document?: TelegramFile;
    photo?: Array<TelegramFile>;
  };
  callback_query?: {
    id: string; data?: string;
    message?: { chat: { id: number; type: string; username?: string } };
    from?: { username?: string };
  };
};

const nextId = (items: Array<{ id: number }>) => Math.max(0, ...items.map((item) => item.id)) + 1;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const html = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const receiptButton = (contractId: number, period: string) => ({
  inline_keyboard: [[{
    text: "📎 Отправить квитанцию",
    callback_data: `receipt:${contractId}:${period}`
  }]]
});

function detectedMime(content: Buffer) {
  if (content.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return "image/jpeg";
  if (content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function receiptTask(data: AppData, contractId: number, period: string, reference: string) {
  if (data.tasks.some((task) => task.description.includes(reference))) return;
  const contract = data.contracts.find((item) => item.id === contractId);
  data.tasks.push({
    id: nextId(data.tasks),
    title: `Чек получен · ${contract?.contractNumber ?? "договор"} · ${period}`,
    description: `Telegram ${reference}: квитанция сохранена. Проверьте поступление денег и затем отметьте оплату.`,
    dueDate: new Date().toISOString().slice(0, 16),
    priority: "high",
    status: "in_progress",
    relatedEntityType: "contract_payment",
    relatedEntityId: contractId,
    paymentPeriod: period
  } satisfies Task);
}

export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!botToken || !webhookSecret || !secureEqual(receivedSecret, webhookSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const update = await request.json() as TelegramUpdate;
  const state = await prisma.appState.findUnique({ where: { id: 1 } });
  if (!state) return NextResponse.json({ error: "State unavailable" }, { status: 503 });
  const data = structuredClone(state.payload) as unknown as AppData;
  data.telegramBindings ??= [];
  data.telegramInvites ??= [];
  data.telegramPendingReceipts ??= [];
  let changed = false;

  const message = update.message;
  const startToken = message?.text?.match(/^\/start\s+([A-Za-z0-9_-]{20,100})$/)?.[1];
  if (message && startToken) {
    if (message.chat.type !== "private") {
      await sendTelegramMessage(botToken, String(message.chat.id), "Привязка доступна только в личном чате с ботом.");
      return NextResponse.json({ ok: true });
    }
    const now = new Date();
    const invite = data.telegramInvites.find((item) =>
      !item.usedAt && item.tokenHash === hash(startToken) && new Date(item.expiresAt) > now
    );
    if (!invite) {
      await sendTelegramMessage(botToken, String(message.chat.id), "Ссылка недействительна или истекла. Попросите сотрудника сформировать новую.");
      return NextResponse.json({ ok: true });
    }
    const existing = data.telegramBindings.find((item) => item.contractId === invite.contractId);
    if (existing) {
      existing.chatId = String(message.chat.id);
      existing.username = message.from?.username ?? message.chat.username;
      existing.linkedAt = now.toISOString();
      existing.isActive = true;
    } else {
      data.telegramBindings.push({
        id: nextId(data.telegramBindings),
        customerId: invite.customerId,
        contractId: invite.contractId,
        chatId: String(message.chat.id),
        username: message.from?.username ?? message.chat.username,
        linkedAt: now.toISOString(),
        isActive: true
      } satisfies TelegramBinding);
    }
    invite.usedAt = now.toISOString();
    changed = true;
    const contract = data.contracts.find((item) => item.id === invite.contractId);
    await sendTelegramMessage(
      botToken,
      String(message.chat.id),
      `✅ Уведомления подключены.\nДоговор: <b>${html(contract?.contractNumber ?? "")}</b>\n\nБот будет заранее присылать реквизиты оплаты. Для отправки чека нажмите кнопку ниже.`,
      receiptButton(invite.contractId, currentPaymentPeriod(now))
    );
  }

  if (message?.text?.match(/^\/start(?:@\w+)?$/) && !startToken) {
    const chatId = String(message.chat.id);
    const bindings = data.telegramBindings.filter((item) => item.chatId === chatId && item.isActive);
    if (!bindings.length) {
      await sendTelegramMessage(botToken, chatId, "Бот ещё не связан с договором. Попросите сотрудника прислать персональную ссылку из карточки клиента.");
    } else {
      const period = currentPaymentPeriod(new Date());
      for (const binding of bindings) {
        const contract = data.contracts.find((item) => item.id === binding.contractId);
        await sendTelegramMessage(
          botToken,
          chatId,
          `Договор: <b>${html(contract?.contractNumber ?? "")}</b>\nПериод оплаты: <b>${period}</b>\n\nНажмите кнопку, затем отправьте фото или PDF квитанции.`,
          receiptButton(binding.contractId, period)
        );
      }
    }
  }

  const callback = update.callback_query;
  const callbackMatch = callback?.data?.match(/^receipt:(\d+):(\d{4}-\d{2})$/);
  if (callback?.message && callbackMatch) {
    const chatId = String(callback.message.chat.id);
    const contractId = Number(callbackMatch[1]);
    const period = callbackMatch[2];
    const binding = data.telegramBindings.find((item) =>
      item.chatId === chatId && item.contractId === contractId && item.isActive
    );
    if (!binding) {
      await answerTelegramCallback(botToken, callback.id, "Договор не привязан к этому чату");
    } else {
      const expires = new Date();
      expires.setHours(expires.getHours() + 24);
      data.telegramPendingReceipts = data.telegramPendingReceipts.filter((item) => item.chatId !== chatId);
      data.telegramPendingReceipts.push({ chatId, contractId, period, expiresAt: expires.toISOString() });
      changed = true;
      await answerTelegramCallback(botToken, callback.id, "Теперь прикрепите квитанцию");
      await sendTelegramMessage(botToken, chatId, `Пришлите квитанцию за <b>${period}</b> одним файлом: PDF, JPG, PNG или WebP, не более 10 МБ.`);
    }
  }

  const incomingFile = message?.document ?? message?.photo?.[message.photo.length - 1];
  if (message && incomingFile && !startToken) {
    const chatId = String(message.chat.id);
    const pending = data.telegramPendingReceipts.find((item) =>
      item.chatId === chatId && new Date(item.expiresAt) > new Date()
    );
    if (!pending) {
      await sendTelegramMessage(botToken, chatId, "Сначала нажмите «Отправить квитанцию» в уведомлении об оплате.");
      return NextResponse.json({ ok: true });
    }
    const binding = data.telegramBindings.find((item) =>
      item.chatId === chatId && item.contractId === pending.contractId && item.isActive
    );
    if (!binding) return NextResponse.json({ ok: true });
    try {
      assertS3Configured();
      const content = await downloadTelegramFile(botToken, incomingFile.file_id);
      const mimeType = detectedMime(content);
      if (!mimeType) throw new Error("Поддерживаются только PDF, JPG, PNG и WebP");
      const fileName = (incomingFile.file_name ?? `telegram-receipt-${pending.period}.${mimeType === "application/pdf" ? "pdf" : mimeType.split("/")[1]}`)
        .normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120);
      const key = `receipts/${pending.contractId}/${pending.period}/${randomUUID()}-${fileName}`;
      const encrypted = encryptDocument(content, mimeType);
      await s3.send(new PutObjectCommand({
        Bucket: documentsBucket, Key: key, Body: encrypted.body, ContentType: "application/octet-stream",
        Metadata: { originalname: encodeURIComponent(fileName), ...encrypted.metadata }
      }));
      data.documents.push({
        id: nextId(data.documents), entityType: "contract", entityId: pending.contractId,
        fileName, fileUrl: `/api/documents?key=${encodeURIComponent(key)}`,
        documentType: "receipt", mimeType, fileSize: content.length, uploadedAt: new Date().toISOString()
      } satisfies DocumentItem);
      const reference = `TG-${update.update_id}`;
      receiptTask(data, pending.contractId, pending.period, reference);
      data.telegramPendingReceipts = data.telegramPendingReceipts.filter((item) => item !== pending);
      changed = true;
      await sendTelegramMessage(
        botToken,
        chatId,
        "✅ Квитанция получена и прикреплена к договору. Сотрудник проверит поступление денег.",
        receiptButton(pending.contractId, pending.period)
      );
    } catch (error) {
      await sendTelegramMessage(botToken, chatId, `Не удалось сохранить квитанцию: ${html(error instanceof Error ? error.message : "ошибка файла")}.`);
    }
  }

  if (changed) {
    await prisma.appState.update({
      where: { id: 1 },
      data: { payload: data as unknown as Prisma.InputJsonValue, version: { increment: 1 } }
    });
  }
  return NextResponse.json({ ok: true });
}
