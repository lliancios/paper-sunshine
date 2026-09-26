// pdf.js adapter: turns a loaded PDF into RawPages. Works in the browser and
// in Node (tests) because it only relies on the public pdf.js document API.
import { buildDocModel, type RawPage } from "./layout";
import type { DocModel, RawItem } from "./types";

type Matrix = [number, number, number, number, number, number];

function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

// Minimal structural types so this file does not import pdf.js directly.
interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}
interface PdfPage {
  getViewport(o: { scale: number }): { width: number; height: number; transform: number[] };
  getTextContent(): Promise<{ items: unknown[]; styles: Record<string, { ascent?: number; descent?: number; vertical?: boolean }> }>;
  cleanup?: () => void;
}
export interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  getMetadata?(): Promise<{ info?: Record<string, unknown> }>;
}

export async function extractRawPages(pdf: PdfDoc, onProgress?: (done: number, total: number) => void): Promise<RawPage[]> {
  const pages: RawPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: RawItem[] = [];
    for (const raw of tc.items) {
      const it = raw as PdfTextItem;
      if (typeof it.str !== "string" || !it.str) continue;
      const style = tc.styles[it.fontName] ?? {};
      if (style.vertical) continue;
      const tx = mul(vp.transform as Matrix, it.transform as Matrix);
      const angle = Math.atan2(tx[1], tx[0]);
      if (Math.abs(angle) > 0.02) continue; // rotated text (watermarks, axis labels)
      const fh = Math.hypot(tx[2], tx[3]);
      if (fh < 1.5 || it.width <= 0) continue;
      const asc = style.ascent && style.ascent > 0.3 ? style.ascent : 0.8;
      const desc = style.descent && style.descent < 0 ? -style.descent : 0.2;
      const top = tx[5] - fh * asc;
      items.push({
        str: it.str,
        x: tx[4],
        y: top,
        w: it.width,
        h: fh * (asc + desc),
        base: tx[5],
        fs: fh,
        font: it.fontName,
      });
    }
    pages.push({ w: vp.width, h: vp.height, items });
    page.cleanup?.();
    onProgress?.(i, pdf.numPages);
  }
  return pages;
}

export async function extractDocModel(pdf: PdfDoc, onProgress?: (done: number, total: number) => void): Promise<DocModel> {
  const pages = await extractRawPages(pdf, onProgress);
  let pdfTitle: string | undefined;
  let extraText = "";
  try {
    const md = await pdf.getMetadata?.();
    const info = md?.info ?? {};
    if (typeof info.Title === "string" && info.Title.trim().length > 5) pdfTitle = info.Title.trim();
    extraText = [info.Subject, info.Keywords, info.Title].filter((x) => typeof x === "string").join("\n");
  } catch {
    /* metadata is optional */
  }
  return buildDocModel(pages, { pdfTitle, extraText });
}
