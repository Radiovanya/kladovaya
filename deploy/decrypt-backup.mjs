import { createDecipheriv } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [source, destination, ivBase64, tagBase64] = process.argv.slice(2);
if (!source || !destination || !ivBase64 || !tagBase64) {
  throw new Error("Usage: decrypt-backup.mjs SOURCE DESTINATION IV_BASE64 TAG_BASE64");
}
const key = Buffer.from(process.env.DOCUMENT_ENCRYPTION_KEY ?? "", "base64");
if (key.length !== 32) throw new Error("DOCUMENT_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivBase64, "base64"));
decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
const encrypted = await readFile(source);
await writeFile(destination, Buffer.concat([decipher.update(encrypted), decipher.final()]));
