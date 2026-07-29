import { Prisma } from "@prisma/client";
import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { buildPaymentQrPayload, effectiveChargeStatus, money, paymentPurpose } from "@/lib/business";
import { prisma } from "@/lib/prisma";
import { secureEqual } from "@/lib/server/security";
import { sendTelegramMessage, sendTelegramPhoto } from "@/lib/server/telegram";
import type { AppData, TelegramNotification } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const html = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const dateOnly = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export async function POST(request: Request) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  if (!botToken || !secret || !secureEqual(authorization, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const state = await prisma.appState.findUnique({ where: { id: 1 } });
  if (!state) return NextResponse.json({ error: "State unavailable" }, { status: 503 });
  const data = structuredClone(state.payload) as unknown as AppData;
  data.telegramBindings ??= [];
  data.telegramNotifications ??= [];
  data.paymentRequests ??= [];
  const now = new Date();
  const today = dateOnly(now);
  let sent = 0;

  for (const binding of data.telegramBindings.filter((item) => item.isActive)) {
    const contract = data.contracts.find((item) => item.id === binding.contractId);
    if (!contract || contract.status !== "active" || contract.startDate > today || contract.endDate < today) continue;
    const charge = data.charges
      .filter((item) =>
        item.contractId === contract.id &&
        item.chargeType === "rent" &&
        item.status !== "cancelled" &&
        effectiveChargeStatus(item.id, data, now) !== "paid"
      )
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    if (!charge) continue;
    const period = charge.periodStart.slice(0, 7);
    const dueDate = charge.dueDate;
    const advance = new Date(`${dueDate}T00:00:00`);
    advance.setDate(advance.getDate() - (contract.advanceNoticeDays ?? 3));
    const kind: TelegramNotification["kind"] | null =
      today >= dueDate ? "due" : today >= dateOnly(advance) ? "advance" : null;
    if (!kind || data.telegramNotifications.some((item) =>
      item.contractId === contract.id && item.period === period && item.kind === kind
    )) continue;

    const customer = data.customers.find((item) => item.id === contract.customerId);
    const purpose = paymentPurpose(contract.contractNumber, period);
    const periodLabel = `${charge.periodStart.split("-").reverse().join(".")}–${charge.periodEnd.split("-").reverse().join(".")}`;
    const button = {
      inline_keyboard: [[{ text: "📎 Отправить квитанцию", callback_data: `receipt:${contract.id}:${period}` }]]
    };
    try {
      if ((contract.landlordType ?? "entrepreneur") === "individual") {
        const profile = data.landlordSettings?.individual;
        if (!profile?.cardNumber || !profile.bankName) throw new Error("Не заполнены карта и банк физлица");
        await sendTelegramMessage(
          botToken,
          binding.chatId,
          `${kind === "advance" ? "🔔 Напоминание об оплате" : "📅 Сегодня срок оплаты"}\n\n` +
          `Договор: <b>${html(contract.contractNumber)}</b>\n` +
          `Арендатор: ${html(customer?.fullName ?? "")}\n` +
          `Период: <b>${periodLabel}</b>\n` +
          `Сумма: <b>${html(money(charge.amount))}</b>\n` +
          `Получатель: ${html(profile.fullName)}\n` +
          `Банк: <b>${html(profile.bankName)}</b>\n` +
          `Номер карты: <code>${html(profile.cardNumber)}</code>\n` +
          `Назначение: ${html(purpose)}\n\nПосле оплаты нажмите кнопку и пришлите квитанцию.`,
          button
        );
      } else {
        if (!data.paymentSettings) throw new Error("Не заполнены банковские реквизиты ИП");
        const payload = buildPaymentQrPayload(data.paymentSettings, charge.amount, purpose);
        const qr = await QRCode.toBuffer(payload, {
          width: 650, margin: 4, errorCorrectionLevel: "L",
          color: { dark: "#000000", light: "#ffffff" }
        });
        await sendTelegramPhoto(
          botToken,
          binding.chatId,
          qr,
          `${kind === "advance" ? "🔔 Напоминание об оплате" : "📅 Сегодня срок оплаты"}\n\n` +
          `Договор: <b>${html(contract.contractNumber)}</b>\n` +
          `Период: <b>${periodLabel}</b>\n` +
          `Сумма: <b>${html(money(charge.amount))}</b>\n` +
          `Назначение: ${html(purpose)}\n\nОтсканируйте QR банковским приложением. После оплаты нажмите кнопку и пришлите квитанцию.`,
          button
        );
      }
      data.telegramNotifications.push({ contractId: contract.id, period, kind, sentAt: now.toISOString() });
      const task = data.tasks.find((item) =>
        item.relatedEntityType === "contract_payment" &&
        item.relatedEntityId === contract.id &&
        item.paymentPeriod === period
      );
      if (task && task.status === "open") task.status = "sent";
      const requestRecord = [...data.paymentRequests].reverse().find((item) =>
        item.contractId === contract.id && item.period === period
      );
      if (requestRecord) {
        requestRecord.status = "sent";
        requestRecord.recipientEmail = `telegram:${binding.chatId}`;
      } else {
        data.paymentRequests.push({
          id: Math.max(0, ...data.paymentRequests.map((item) => item.id)) + 1,
          contractId: contract.id, period, amount: charge.amount, purpose,
          recipientEmail: `telegram:${binding.chatId}`, status: "sent", createdAt: now.toISOString()
        });
      }
      sent += 1;
    } catch (error) {
      const taskId = Math.max(0, ...data.tasks.map((item) => item.id)) + 1;
      data.tasks.push({
        id: taskId,
        title: `Не отправлено в Telegram · ${contract.contractNumber}`,
        description: error instanceof Error ? error.message : "Ошибка Telegram",
        dueDate: now.toISOString().slice(0, 16),
        priority: "high", status: "open",
        relatedEntityType: "contract_payment", relatedEntityId: contract.id, paymentPeriod: period
      });
    }
  }

  if (sent || data.tasks.some((item) => item.dueDate === now.toISOString().slice(0, 16))) {
    await prisma.appState.update({
      where: { id: 1 },
      data: { payload: data as unknown as Prisma.InputJsonValue, version: { increment: 1 } }
    });
  }
  return NextResponse.json({ ok: true, sent });
}
