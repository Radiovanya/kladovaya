import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";

const regularFonts = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf"
];
const boldFonts = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
];

const findFont = (candidates: string[]) => candidates.find(existsSync);
const plainText = (value: string) => value.replaceAll("**", "").trim();

export async function createContractPdf(markdown: string) {
  const regular = findFont(regularFonts);
  const bold = findFont(boldFonts) ?? regular;
  if (!regular || !bold) throw new Error("На сервере не найден шрифт для формирования PDF");

  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({
      size: "A4",
      font: regular,
      margins: { top: 42, right: 46, bottom: 46, left: 46 },
      info: { Title: "Договор аренды" }
    });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.font(regular).fontSize(10).fillColor("#111111");

    for (const sourceLine of markdown.split("\n")) {
      const line = sourceLine.trim();
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (!line) {
        document.moveDown(0.35);
      } else if (heading) {
        const level = heading[1].length;
        document.moveDown(level === 1 ? 0.5 : 0.25)
          .font(bold)
          .fontSize(level === 1 ? 16 : level === 2 ? 13 : 11)
          .text(plainText(heading[2]), { align: level === 1 ? "center" : "left", lineGap: 2 })
          .font(regular).fontSize(10)
          .moveDown(0.25);
      } else if (/^---+$/.test(line)) {
        const y = document.y + 3;
        document.moveTo(document.page.margins.left, y)
          .lineTo(document.page.width - document.page.margins.right, y)
          .strokeColor("#999999").lineWidth(0.5).stroke()
          .moveDown(0.7);
      } else if (line.startsWith("- ")) {
        document.font(regular).fontSize(10).text(`• ${plainText(line.slice(2))}`, { indent: 12, lineGap: 2 });
      } else {
        document.font(regular).fontSize(10).text(plainText(line), { align: "justify", lineGap: 2 });
      }
    }
    document.end();
  });
}
