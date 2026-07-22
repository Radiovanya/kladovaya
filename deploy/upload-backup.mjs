import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createRequire } from "node:module";

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

await client.send(new PutObjectCommand({
  Bucket: process.env.S3_BUCKET,
  Key: key,
  Body: await readFile(file),
  ContentType: "application/gzip",
  Metadata: { source: "postgresql", filename: basename(file) }
}));
