const apiBase = (token: string) => `https://api.telegram.org/bot${token}`;

async function telegramRequest<T>(token: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase(token)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.description ?? `Telegram ${method} failed`);
  return payload.result as T;
}

export function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
  replyMarkup?: Record<string, unknown>
) {
  return telegramRequest(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {})
  });
}

export async function sendTelegramPhoto(
  token: string,
  chatId: string,
  photo: Buffer,
  caption: string,
  replyMarkup?: Record<string, unknown>
) {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  form.set("photo", new Blob([new Uint8Array(photo)], { type: "image/png" }), "payment-qr.png");
  if (replyMarkup) form.set("reply_markup", JSON.stringify(replyMarkup));
  const response = await fetch(`${apiBase(token)}/sendPhoto`, {
    method: "POST", body: form, signal: AbortSignal.timeout(20_000)
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; description?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.description ?? "Telegram sendPhoto failed");
}

export async function answerTelegramCallback(token: string, callbackQueryId: string, text?: string) {
  return telegramRequest(token, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {})
  });
}

export async function downloadTelegramFile(token: string, fileId: string) {
  const file = await telegramRequest<{ file_path?: string; file_size?: number }>(token, "getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram file path is missing");
  if ((file.file_size ?? 0) > 10 * 1024 * 1024) throw new Error("Файл больше 10 МБ");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error("Не удалось скачать файл из Telegram");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 10 * 1024 * 1024) throw new Error("Файл больше 10 МБ");
  return buffer;
}
