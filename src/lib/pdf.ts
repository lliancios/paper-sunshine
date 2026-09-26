"use client";
// pdf.js loading and page rendering (browser only). Uses the legacy build for
// broader Safari/iPadOS support; the worker and fonts are served from /public.
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { db } from "./db";

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

export function loadPdfjs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
      const lib = m as unknown as PdfJs;
      lib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(data: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return pdfjs.getDocument({
    data: bytes,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  }).promise;
}

const docCache = new Map<string, Promise<PDFDocumentProxy>>();

export function getPaperPdf(paperId: string): Promise<PDFDocumentProxy> {
  let p = docCache.get(paperId);
  if (!p) {
    p = db.files.get(paperId).then(async (f) => {
      if (!f) {
        // Synced from another device: fetch the PDF from the cloud on first use.
        const { ensurePaperLocal } = await import("./sync");
        await ensurePaperLocal(paperId);
        f = await db.files.get(paperId);
      }
      if (!f) throw new Error("找不到 PDF 檔案");
      return openPdf(await f.blob.arrayBuffer());
    });
    p.catch(() => docCache.delete(paperId));
    docCache.set(paperId, p);
  }
  return p;
}

export function releasePaperPdf(paperId: string) {
  const p = docCache.get(paperId);
  docCache.delete(paperId);
  p?.then((d) => d.loadingTask.destroy()).catch(() => {});
}

const pageCache = new Map<string, Promise<PDFPageProxy>>();
export function getPage(paperId: string, index: number): Promise<PDFPageProxy> {
  const key = `${paperId}:${index}`;
  let p = pageCache.get(key);
  if (!p) {
    p = getPaperPdf(paperId).then((d) => d.getPage(index + 1));
    pageCache.set(key, p);
  }
  return p;
}

/** Max device pixels per canvas; keeps iPad Safari well under its memory cap. */
const MAX_PIXELS = 7_000_000;

export interface RenderHandle {
  promise: Promise<HTMLCanvasElement | null>;
  cancel: () => void;
}

/**
 * Renders a page into a fresh offscreen canvas (so the visible canvas never
 * flashes blank while zooming). Resolves to null when cancelled.
 */
export function renderPage(paperId: string, index: number, scale: number): RenderHandle {
  let cancelled = false;
  let task: { cancel: () => void; promise: Promise<void> } | null = null;
  const promise = (async () => {
    const page = await getPage(paperId, index);
    if (cancelled) return null;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    const base = page.getViewport({ scale });
    let ratio = dpr;
    if (base.width * base.height * ratio * ratio > MAX_PIXELS) ratio = Math.sqrt(MAX_PIXELS / (base.width * base.height));
    const vp = page.getViewport({ scale: scale * ratio });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    task = page.render({ canvas, canvasContext: ctx, viewport: vp });
    try {
      await task.promise;
    } catch {
      canvas.width = canvas.height = 0;
      return null;
    }
    if (cancelled) {
      canvas.width = canvas.height = 0;
      return null;
    }
    return canvas;
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      task?.cancel();
    },
  };
}

/**
 * Shared render cache: in split view both panes need the same page bitmap, so
 * the first pane to ask renders it and the second one reuses it. The bitmap
 * is freed shortly after the last pane releases it (keeps iPad memory low).
 */
const shared = new Map<string, { handle: RenderHandle; refs: number; timer?: ReturnType<typeof setTimeout> }>();
export function acquireRender(paperId: string, index: number, scale: number): { promise: Promise<HTMLCanvasElement | null>; release: () => void } {
  const key = `${paperId}:${index}:${scale.toFixed(3)}`;
  let e = shared.get(key);
  if (!e) {
    e = { handle: renderPage(paperId, index, scale), refs: 0 };
    shared.set(key, e);
  }
  const entry = e;
  entry.refs++;
  clearTimeout(entry.timer);
  let released = false;
  return {
    promise: entry.handle.promise,
    release: () => {
      if (released) return;
      released = true;
      entry.refs--;
      if (entry.refs > 0) return;
      entry.timer = setTimeout(() => {
        if (entry.refs > 0) return;
        shared.delete(key);
        entry.handle.cancel();
        void entry.handle.promise.then((c) => {
          if (c) c.width = c.height = 0;
        });
      }, 1500);
    },
  };
}

/** Copies an offscreen render into a visible canvas. */
export function blit(src: HTMLCanvasElement, dst: HTMLCanvasElement | null) {
  if (!dst) return;
  if (dst.width !== src.width) dst.width = src.width;
  if (dst.height !== src.height) dst.height = src.height;
  const ctx = dst.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, dst.width, dst.height);
  ctx.drawImage(src, 0, 0);
}

/** Samples the paper colour around each rect (handles scanned, off-white pages). */
export function samplePaperColors(canvas: HTMLCanvasElement, rects: { id: string; r: [number, number, number, number] }[], pxPerUnit: number) {
  const out = new Map<string, string>();
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return out;
  for (const { id, r } of rects) {
    const pts: [number, number][] = [];
    const pad = 3 / pxPerUnit;
    const xs = [r[0] - pad, (r[0] + r[2]) / 2, r[2] + pad];
    const ys = [r[1] - pad, (r[1] + r[3]) / 2, r[3] + pad];
    for (const x of xs) for (const y of ys) if (!(x === xs[1] && y === ys[1])) pts.push([x, y]);
    const samples: number[][] = [];
    for (const [x, y] of pts) {
      const px = Math.round(x * pxPerUnit);
      const py = Math.round(y * pxPerUnit);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
      const d = ctx.getImageData(px, py, 1, 1).data;
      samples.push([d[0], d[1], d[2]]);
    }
    if (!samples.length) {
      out.set(id, "#ffffff");
      continue;
    }
    const med = [0, 1, 2].map((ch) => {
      const v = samples.map((s) => s[ch]).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    });
    const lum = 0.299 * med[0] + 0.587 * med[1] + 0.114 * med[2];
    out.set(id, lum < 170 ? "#ffffff" : `rgb(${med[0]},${med[1]},${med[2]})`);
  }
  return out;
}

/** Renders a region of a page to a JPEG (base64, no prefix) for figure explanations. */
export async function renderRegion(paperId: string, index: number, rect: [number, number, number, number]): Promise<{ base64: string; dataUrl: string }> {
  const page = await getPage(paperId, index);
  const w = rect[2] - rect[0];
  const h = rect[3] - rect[1];
  const scale = Math.min(3, Math.max(1.5, 1400 / Math.max(w, 1)));
  const vp = page.getViewport({ scale });
  const full = document.createElement("canvas");
  full.width = Math.floor(vp.width);
  full.height = Math.floor(vp.height);
  await page.render({ canvas: full, canvasContext: full.getContext("2d")!, viewport: vp }).promise;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.floor(w * scale));
  out.height = Math.max(1, Math.floor(h * scale));
  out.getContext("2d")!.drawImage(full, rect[0] * scale, rect[1] * scale, w * scale, h * scale, 0, 0, out.width, out.height);
  // JPEG keeps the upload far below Vercel's 4.5 MB request limit.
  const ctx = out.getContext("2d")!;
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  const dataUrl = out.toDataURL("image/jpeg", 0.9);
  full.width = full.height = 0;
  return { base64: dataUrl.split(",")[1] ?? "", dataUrl };
}

export async function thumbnail(dataUrl: string, maxW = 360): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const s = Math.min(1, maxW / img.width);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}
