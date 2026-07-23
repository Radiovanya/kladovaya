import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { decryptDocument, encryptDocument } from "../lib/server/document-crypto";
import { hasTrustedOrigin, readBoundedJson } from "../lib/server/security";

test("документ шифруется AES-256-GCM и расшифровывается без потерь", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const source = Buffer.from("конфиденциальный договор");
  const encrypted = encryptDocument(source, "application/pdf");
  assert.notDeepEqual(encrypted.body, source);
  const decrypted = decryptDocument(encrypted.body, encrypted.metadata);
  assert.deepEqual(decrypted.body, source);
  assert.equal(decrypted.contentType, "application/pdf");
});

test("подмена зашифрованного документа обнаруживается", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const encrypted = encryptDocument(Buffer.from("receipt"), "image/jpeg");
  encrypted.body[0] ^= 1;
  assert.throws(() => decryptDocument(encrypted.body, encrypted.metadata));
});

test("изменяющий запрос с чужого сайта отклоняется", () => {
  const trusted = new Request("https://klad-v.ru/api/state", { headers: { origin: "https://klad-v.ru", host: "klad-v.ru" } });
  const untrusted = new Request("https://klad-v.ru/api/state", { headers: { origin: "https://attacker.example", host: "klad-v.ru" } });
  assert.equal(hasTrustedOrigin(trusted), true);
  assert.equal(hasTrustedOrigin(untrusted), false);
});

test("ограничение JSON проверяет фактический размер тела", async () => {
  const request = new Request("https://klad-v.ru/api/state", { method: "POST", body: JSON.stringify({ value: "12345" }) });
  await assert.rejects(() => readBoundedJson(request, 5), /PAYLOAD_TOO_LARGE/);
});
