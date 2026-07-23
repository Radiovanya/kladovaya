import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createRequire } from "node:module";
import { createCipheriv, randomBytes } from "node:crypto";

const require = createRequire("/opt/kladovaya/app/server.js");
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const [file, key] = process.argv.slice(2);
if (!file || !key) throw new Error("Usage: upload-backup.mjs FILE KEY");

const client = new S3Client({
  region: process.env.S3_REGION ?? "ru1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
});

const encryptionKey = Buffer.from(process.env.DOCUMENT_ENCRYPTION_KEY ?? "", "base64");
if (encryptionKey.length !== 32) throw new Error("DOCUMENT_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
const content = await readFile(file);
const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);

await client.send(new PutObjectCommand({
  Bucket: process.env.S3_BUCKET,
  Key: key,
  Body: encrypted,
  ContentType: "application/octet-stream",
  Metadata: {
    source: "postgresql", filename: basename(file), encryption: "aes-256-gcm",
    iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), contenttype: "application/gzip"
  }
}));
