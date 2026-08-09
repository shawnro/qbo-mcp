import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const MAX_PDF_RENDER_PAGES = 3;
export const MAX_PDF_PAGE_DIMENSION = 1800;
export const MAX_PDF_PAGE_IMAGE_BYTES = 1536 * 1024;
export const MAX_PDF_TOTAL_IMAGE_BYTES = 3 * 1024 * 1024;

const JPEG_QUALITY = 0.82;

export interface RenderedPdfPage {
  page: number;
  data: Buffer;
  width: number;
  height: number;
}

export interface RenderedPdfPages {
  pageCount: number;
  pages: RenderedPdfPage[];
}

export async function renderPdfPages(
  bytes: Buffer,
  options: { pageStart?: number; pageCount?: number } = {}
): Promise<RenderedPdfPages> {
  const pageStart = options.pageStart ?? 1;
  const requestedCount = options.pageCount ?? MAX_PDF_RENDER_PAGES;
  if (!Number.isInteger(pageStart) || pageStart < 1) {
    throw new Error("page_start must be a positive integer");
  }
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_PDF_RENDER_PAGES) {
    throw new Error(`page_count must be an integer from 1 to ${MAX_PDF_RENDER_PAGES}`);
  }

  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  try {
    let document;
    try {
      document = await loadingTask.promise;
    } catch (error) {
      throw new Error(
        `Unable to parse PDF: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (pageStart > document.numPages) {
      throw new Error(`page_start ${pageStart} exceeds PDF page count ${document.numPages}`);
    }

    const endPage = Math.min(document.numPages, pageStart + requestedCount - 1);
    const pages: RenderedPdfPage[] = [];
    let totalImageBytes = 0;
    for (let pageNumber = pageStart; pageNumber <= endPage; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(
          2,
          MAX_PDF_PAGE_DIMENSION / Math.max(baseViewport.width, baseViewport.height)
        );
        const viewport = page.getViewport({ scale });
        const width = Math.max(1, Math.ceil(viewport.width));
        const height = Math.max(1, Math.ceil(viewport.height));
        const canvas = createCanvas(width, height);
        const context = canvas.getContext("2d");
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;
        const data = canvas.toBuffer("image/jpeg", JPEG_QUALITY);
        if (data.length > MAX_PDF_PAGE_IMAGE_BYTES) {
          throw new Error(
            `Rendered PDF page ${pageNumber} is too large (${data.length} bytes; max ${MAX_PDF_PAGE_IMAGE_BYTES})`
          );
        }
        totalImageBytes += data.length;
        if (totalImageBytes > MAX_PDF_TOTAL_IMAGE_BYTES) {
          throw new Error(
            `Rendered PDF pages are too large (${totalImageBytes} bytes; max ${MAX_PDF_TOTAL_IMAGE_BYTES})`
          );
        }
        pages.push({ page: pageNumber, data, width, height });
      } finally {
        page.cleanup();
      }
    }

    return { pageCount: document.numPages, pages };
  } finally {
    await loadingTask.destroy();
  }
}
