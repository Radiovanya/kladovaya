import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey() {
  const encoded = process.env.DOCUMENT_ENCRYPTION_KEY ?? "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("DOCUMENT_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

export function encryptDocument(content: Buffer, contentType: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(content), cipher.final()]);
  return {
    body,
    metadata: {
      encryption: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      contenttype: contentType
    }
  };
}

export function decryptDocument(content: Buffer, metadata: Record<string, string> | undefined) {
  if (metadata?.encryption !== "aes-256-gcm") return { body: content, contentType: undefined };
  const iv = Buffer.from(metadata.iv ?? "", "base64");
  const tag = Buffer.from(metadata.tag ?? "", "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("Invalid encrypted document metadata");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return { body: Buffer.concat([decipher.update(content), decipher.final()]), contentType: metadata.contenttype };
}
