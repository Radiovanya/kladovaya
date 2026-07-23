import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/server/auth";
import { assertS3Configured, documentsBucket, s3 } from "@/lib/server/s3";
import { hasTrustedOrigin } from "@/lib/server/security";
import { decryptDocument, encryptDocument } from "@/lib/server/document-crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function detectedMime(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function objectKeyFromRequest(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!/^(contracts|receipts)\/[a-zA-Z0-9._/-]+$/.test(key) || key.includes("..")) throw new Error("Invalid object key");
  return key;
}

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 11 * 1024 * 1024) return NextResponse.json({ error: "Запрос больше 11 МБ" }, { status: 413 });
  assertS3Configured();
  const form = await request.formData();
  const file = form.get("file");
  const contractId = String(form.get("contractId") ?? "unknown").replace(/[^0-9]/g, "") || "unknown";
  if (!file || typeof file === "string") return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Файл больше 10 МБ" }, { status: 413 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = detectedMime(buffer);
  if (!mimeType || mimeType !== file.type) return NextResponse.json({ error: "Содержимое файла не соответствует допустимому PDF/JPG/PNG/WebP" }, { status: 400 });

  const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "document";
  const key = `contracts/${contractId}/${randomUUID()}-${safeName}`;
  const encrypted = encryptDocument(buffer, mimeType);
  await s3.send(new PutObjectCommand({
    Bucket: documentsBucket,
    Key: key,
    Body: encrypted.body,
    ContentType: "application/octet-stream",
    Metadata: { originalname: encodeURIComponent(file.name.slice(0, 200)), ...encrypted.metadata }
  }));
  return NextResponse.json({ key, url: `/api/documents?key=${encodeURIComponent(key)}` });
}

export async function GET(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  assertS3Configured();
  const key = objectKeyFromRequest(request);
  const object = await s3.send(new GetObjectCommand({ Bucket: documentsBucket, Key: key }));
  if (!object.Body) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  const stored = Buffer.from(await object.Body.transformToByteArray());
  const decrypted = decryptDocument(stored, object.Metadata);
  const contentType = decrypted.contentType || object.ContentType || "application/octet-stream";
  const originalName = object.Metadata?.originalname ? decodeURIComponent(object.Metadata.originalname) : key.split("/").at(-1) || "document";
  const safeName = originalName.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "document";
  const responseBody = Uint8Array.from(decrypted.body).buffer;
  return new NextResponse(responseBody, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function DELETE(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  assertS3Configured();
  const key = objectKeyFromRequest(request);
  await s3.send(new DeleteObjectCommand({ Bucket: documentsBucket, Key: key }));
  return NextResponse.json({ ok: true });
}
