import { NextResponse } from "next/server";
import { contractPdfFileName } from "@/lib/contract-document";
import { getSession } from "@/lib/server/auth";
import { createContractPdf } from "@/lib/server/contract-pdf";
import { hasTrustedOrigin, readBoundedJson } from "@/lib/server/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasTrustedOrigin(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });

  let body: { contractNumber?: string; content?: string } | null;
  try {
    body = await readBoundedJson(request, 1024 * 1024);
  } catch {
    return NextResponse.json({ error: "Слишком большой запрос" }, { status: 413 });
  }
  if (!body?.contractNumber || !body.content) {
    return NextResponse.json({ error: "Недостаточно данных для формирования PDF" }, { status: 400 });
  }

  try {
    const pdf = await createContractPdf(body.content);
    const fileName = contractPdfFileName(body.contractNumber);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch {
    return NextResponse.json({ error: "Не удалось сформировать PDF" }, { status: 500 });
  }
}
