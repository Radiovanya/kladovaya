import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/server/auth";
import { assertS3Configured, documentsBucket, s3 } from "@/lib/server/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function objectKeyFromRequest(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!key || key.includes("..") || key.startsWith("/")) throw new Error("Invalid object key");
  return key;
}

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  assertS3Configured();
  const form = await request.formData();
  const file = form.get("file");
  const contractId = String(form.get("contractId") ?? "unknown").replace(/[^0-9]/g, "") || "unknown";
  if (!file || typeof file === "string") return NextResponse.json({ error: "Файл не выбран" }, { status: 400 });
  if (!allowedTypes.has(file.type)) return NextResponse.json({ error: "Неподдерживаемый тип файла" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Файл больше 10 МБ" }, { status: 413 });

  const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "document";
  const key = `contracts/${contractId}/${randomUUID()}-${safeName}`;
  await s3.send(new PutObjectCommand({
    Bucket: documentsBucket,
    Key: key,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type,
    Metadata: { originalname: encodeURIComponent(file.name) }
  }));
  return NextResponse.json({ key, url: `/api/documents?key=${encodeURIComponent(key)}` });
}

export async function GET(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  assertS3Configured();
  const key = objectKeyFromRequest(request);
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: documentsBucket, Key: key }), { expiresIn: 600 });
  return NextResponse.redirect(url, 307);
}

export async function DELETE(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  assertS3Configured();
  const key = objectKeyFromRequest(request);
  await s3.send(new DeleteObjectCommand({ Bucket: documentsBucket, Key: key }));
  return NextResponse.json({ ok: true });
}
