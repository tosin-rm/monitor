export type PdfLine = { text: string; size?: number; bold?: boolean; gap?: number; pageBreak?: boolean; kind?: "section" | "subheading" | "note" | "alert" };

export function createPdf(lines: PdfLine[], cover?: { title: string; period: string; client: string; website: string; url: string }): Buffer {
  const pages: string[][] = [cover ? createCover(cover) : []];
  let y = 778;
  for (const item of lines) {
    if (item.pageBreak && pages[pages.length - 1]!.length) {
      pages.push([]);
      y = 778;
    }
    if (item.kind === "section") {
      if (y < 86) { pages.push([]); y = 778; }
      pages[pages.length - 1]!.push(`0.91 0.93 0.96 rg 48 ${y - 9} 499 1 re f`);
      pages[pages.length - 1]!.push(`0.91 0.15 0.12 rg 48 ${y - 2} 4 19 re f`);
      pages[pages.length - 1]!.push(textCommand(toPdfText(item.text), 12, true, y, 61, "0.08 0.12 0.18 rg"));
      y -= 31;
      continue;
    }
    const size = item.size ?? (item.kind === "note" ? 8 : item.kind === "subheading" ? 10 : 9.5);
    const maxChars = Math.max(42, Math.floor(94 * (10 / size)));
    const safeText = toPdfText(item.text);
    const wrapped = wrapLine(safeText, maxChars);
    for (const line of wrapped) {
      if (y < 58) {
        pages.push([]);
        y = 778;
      }
      const color = item.kind === "note" ? "0.42 0.48 0.56 rg" : item.kind === "alert" ? "0.72 0.17 0.12 rg" : "0.12 0.18 0.25 rg";
      pages[pages.length - 1]!.push(textCommand(line, size, Boolean(item.bold) || item.kind === "subheading" || item.kind === "alert", y, 48, color));
      y -= size + 5;
    }
    if (item.gap) y -= item.gap;
  }

  const objects = new Map<number, string>();
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  pages.forEach((commands, index) => {
    const pageId = pageIds[index]!;
    const streamId = pageId + 1;
    const footer = textCommand(`Monitor monthly website report - Page ${index + 1} of ${pages.length}`, 8, false, 32, 48, "0.45 0.49 0.55 rg");
    const stream = `${commands.join("\n")}\n${footer}\n`;
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`);
    objects.set(streamId, `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`);
  });

  let document = "%PDF-1.4\n%MonitorReport\n";
  const offsets: number[] = [0];
  const objectCount = 4 + pages.length * 2;
  for (let id = 1; id <= objectCount; id += 1) {
    const object = objects.get(id);
    if (!object) throw new Error("PDF object is missing");
    offsets[id] = Buffer.byteLength(document, "ascii");
    document += `${id} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objectCount; id += 1) {
    document += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(document, "ascii");
}

function createCover(cover: { title: string; period: string; client: string; website: string; url: string }): string[] {
  const commands = [
    "0.98 0.97 0.95 rg 0 0 595 842 re f",
    "0.91 0.15 0.12 rg 0 0 24 842 re f",
    "0.91 0.15 0.12 rg 365 0 230 842 re f",
    "1 1 1 rg 365 842 m 485 842 l 365 690 l h f",
    "0.91 0.15 0.12 rg 48 747 58 5 re f",
    "0.10 0.15 0.23 rg 402 235 154 360 re f",
    textCommand("MONITOR  /  WEBSITE CARE", 10, true, 772, 48, "0.73 0.12 0.10 rg"),
    ...wrapLine(toPdfText(cover.title), 22).map((line, index) => textCommand(line, 28, true, 610 - index * 36, 48)),
    textCommand(cover.period, 16, false, 535, 48, "0.38 0.43 0.50 rg"),
    textCommand("CLIENT", 9, true, 400, 48, "0.85 0.16 0.12 rg"),
    textCommand(cover.client, 13, false, 380, 48),
    textCommand("WEBSITE", 9, true, 340, 48, "0.85 0.16 0.12 rg"),
    textCommand(cover.website, 13, false, 320, 48),
    textCommand("WEBSITE URL", 9, true, 280, 48, "0.85 0.16 0.12 rg"),
    ...wrapLine(toPdfText(cover.url), 44).map((line, index) => textCommand(line, 11, false, 260 - index * 15, 48)),
    textCommand("MONTHLY SERVICE REVIEW", 9, true, 555, 418, "0.86 0.88 0.91 rg"),
    ...wrapLine(toPdfText(cover.website), 16).map((line, index) => textCommand(line, 19, true, 515 - index * 25, 418, "1 1 1 rg")),
    ...wrapLine("Availability, incidents, performance and maintenance activity.", 25).map((line, index) => textCommand(line, 9, false, 435 - index * 14, 418, "0.88 0.90 0.93 rg")),
    textCommand("PREPARED BY MONITOR", 9, true, 196, 402, "1 1 1 rg"),
  ];
  return commands;
}

function textCommand(text: string, size: number, bold: boolean, y: number, x = 48, color = "0.08 0.12 0.18 rg"): string {
  const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  return `${color}\nBT /F${bold ? 2 : 1} ${size} Tf ${x} ${y} Td (${escaped}) Tj ET`;
}

function wrapLine(value: string, maxChars: number): string[] {
  if (!value) return [""];
  const words = value.split(/\s+/);
  const result: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (line) result.push(line);
      for (let start = 0; start < word.length; start += maxChars) result.push(word.slice(start, start + maxChars));
      line = "";
      continue;
    }
    if (line && line.length + word.length + 1 > maxChars) {
      result.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) result.push(line);
  return result;
}

function toPdfText(value: string): string {
  return value
    .replaceAll("→", "->")
    .replaceAll("·", " | ")
    .replaceAll("—", "-")
    .replaceAll("–", "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}
