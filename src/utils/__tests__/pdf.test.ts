import { describe, expect, it } from "vitest";
import {
  MAX_PDF_RENDER_PAGES,
  renderPdfPages,
} from "../pdf.js";

function createTestPdf(pageCount = 1, withScript = false): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pageCount }, (_, index) => 3 + index * 2);
  const fontId = 3 + pageCount * 2;
  const actionId = fontId + 1;
  objects.push(
    `<< /Type /Catalog /Pages 2 0 R${withScript ? ` /OpenAction ${actionId} 0 R` : ""} >>`
  );
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`);
  for (let index = 0; index < pageCount; index++) {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const content = `BT /F1 24 Tf 72 700 Td (Test PDF page ${index + 1}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  if (withScript) {
    objects.push("<< /S /JavaScript /JS (globalThis.qboPdfScriptExecuted = true) >>");
  }

  let pdf = "%PDF-1.4\n%PDFTEST\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "binary");
}

describe("renderPdfPages", () => {
  it("renders a PDF page as bounded JPEG data", async () => {
    const result = await renderPdfPages(createTestPdf());

    expect(result.pageCount).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].page).toBe(1);
    expect(result.pages[0].width).toBeLessThanOrEqual(1800);
    expect(result.pages[0].height).toBeLessThanOrEqual(1800);
    expect(result.pages[0].data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it("supports bounded page ranges", async () => {
    const result = await renderPdfPages(createTestPdf(5), {
      pageStart: 2,
      pageCount: MAX_PDF_RENDER_PAGES,
    });

    expect(result.pageCount).toBe(5);
    expect(result.pages.map((page) => page.page)).toEqual([2, 3, 4]);
  });

  it("renders a document with an embedded script without executing it", async () => {
    const marker = "qboPdfScriptExecuted";
    Reflect.deleteProperty(globalThis, marker);
    try {
      const result = await renderPdfPages(createTestPdf(1, true));
      expect(result.pages).toHaveLength(1);
      expect(Reflect.has(globalThis, marker)).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, marker);
    }
  });

  it("rejects pages beyond the document", async () => {
    await expect(renderPdfPages(createTestPdf(), { pageStart: 2 })).rejects.toThrow(
      "exceeds PDF page count 1"
    );
  });

  it("returns a clear error for malformed PDF data", async () => {
    await expect(renderPdfPages(Buffer.from("not a PDF"))).rejects.toThrow(
      "Unable to parse PDF"
    );
  });
});
