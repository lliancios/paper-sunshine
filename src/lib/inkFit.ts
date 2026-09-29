"use client";
// Scanned papers (JSTOR) carry an OCR text layer whose line widths are often
// wrong: some pages come out half as wide as the print, others 15% wider, so
// selection, hover boxes, highlights and the translation boxes miss the text
// or spill into the next column. When such a page is first drawn, every text
// line is re-measured on the scan itself (where its ink starts and ends) and
// the corrected geometry is saved into the paper's model. Sentence ids and
// offsets do not change, so annotations are unaffected.
import type { DocModel, Rect } from "@/engine/types";
import { db } from "./db";

interface LinePiece {
  sid: string;
  i: number; // index in sentence.pieces
  r: Rect;
  fs: number;
}

type Fit = { pieces: Map<string, Map<number, Rect>>; blocks: Map<string, Rect> };

/** Corrected piece rects (by sentence) and block rects for one page, or null when the page already matches its ink. */
export function measureInkFit(model: DocModel, index: number, canvas: HTMLCanvasElement): Fit | null {
  const page = model.pages[index];
  const W = canvas.width;
  const H = canvas.height;
  const ctx = W && H ? canvas.getContext("2d", { willReadFrequently: true }) : null;
  if (!ctx || !page) return null;
  const img = ctx.getImageData(0, 0, W, H).data;
  const k = W / page.w;
  const blocks = page.blocks.filter((b) => b.kind !== "skip" && b.sids.length);
  const blockOf = (r: Rect) => {
    const cx = (r[0] + r[2]) / 2;
    const cy = (r[1] + r[3]) / 2;
    return blocks.find((bl) => cx >= bl.r[0] - 1 && cx <= bl.r[2] + 1 && cy >= bl.r[1] - 1 && cy <= bl.r[3] + 1);
  };

  // Pieces on this page, grouped by block, then into lines by vertical position.
  const byBlock = new Map<string, LinePiece[]>();
  for (const s of Object.values(model.sentences)) {
    s.pieces.forEach((pc, i) => {
      if (pc.p !== index) return;
      const b = blockOf(pc.r);
      // Figure labels sit next to box borders and arrows: leave them alone.
      if (!b || b.kind === "label") return;
      byBlock.set(b.id, [...(byBlock.get(b.id) ?? []), { sid: s.id, i, r: pc.r, fs: pc.fs }]);
    });
  }
  const lines: LinePiece[][] = [];
  for (const list of byBlock.values()) {
    list.sort((a, b) => (a.r[1] + a.r[3]) / 2 - (b.r[1] + b.r[3]) / 2 || a.r[0] - b.r[0]);
    let cur: LinePiece[] = [];
    let cy = -1e9;
    for (const pc of list) {
      const y = (pc.r[1] + pc.r[3]) / 2;
      if (cur.length && Math.abs(y - cy) > 0.5 * pc.fs) {
        lines.push(cur);
        cur = [];
      }
      if (!cur.length) cy = y;
      cur.push(pc);
    }
    if (cur.length) lines.push(cur);
  }

  const colInk = (x: number, y0: number, y1: number) => {
    if (x < 0 || x >= W) return false;
    for (let y = y0; y <= y1; y += 1) {
      const i = (y * W + x) * 4;
      if (img[i + 3] > 0 && img[i] + img[i + 1] + img[i + 2] < 420) return true;
    }
    return false;
  };
  const fits: { line: LinePiece[]; x0: number; x1: number; a: number; b: number }[] = [];
  for (const line of lines) {
    const x0 = Math.min(...line.map((p) => p.r[0]));
    const x1 = Math.max(...line.map((p) => p.r[2]));
    const top = Math.min(...line.map((p) => p.r[1]));
    const bottom = Math.max(...line.map((p) => p.r[3]));
    const fs = Math.max(...line.map((p) => p.fs));
    if (x1 - x0 < 5 * fs) continue; // short lines: too little to measure reliably
    const y0 = Math.max(0, Math.round((top + 0.2 * (bottom - top)) * k));
    const y1 = Math.min(H - 1, Math.round((bottom - 0.2 * (bottom - top)) * k));
    if (y1 <= y0) continue;
    // Starts are reliable in OCR layers; find the first ink near the start.
    let a = -1;
    for (let x = Math.round((x0 - 1.2 * fs) * k); x <= Math.round((x0 + 1.2 * fs) * k); x++) {
      if (colInk(x, y0, y1)) {
        a = x;
        break;
      }
    }
    if (a < 0) continue;
    // The next block starting to the right of this line's start is a hard stop (other column).
    let limit = page.w;
    for (const bl of blocks) if (bl.r[0] > x0 + 3 * fs && bl.r[1] < bottom && bl.r[3] > top) limit = Math.min(limit, bl.r[0] - 0.5);
    // Walk through the words; a gap wider than about one character height ends the line (column gutter).
    const gapMax = Math.max(3, 1.2 * fs * k);
    let b = a;
    let gap = 0;
    for (let x = a; x < Math.min(W, limit * k); x++) {
      if (colInk(x, y0, y1)) {
        b = x;
        gap = 0;
      } else if (++gap > gapMax) break;
    }
    const ratio = (b - a) / k / (x1 - x0);
    if (ratio < 0.35 || ratio > 2.8) continue; // not the same line (figure, rule): leave it
    fits.push({ line, x0, x1, a: a / k, b: (b + 1) / k });
  }
  // Only pages whose lines clearly miss the print: born-digital text already fits.
  const off = fits.filter((f) => Math.abs((f.b - f.a) / (f.x1 - f.x0) - 1) > 0.08 || Math.abs(f.a - f.x0) > 3).length;
  if (off < Math.max(3, 0.3 * fits.length)) return null;

  const pieces = new Map<string, Map<number, Rect>>();
  const bounds = new Map<string, Rect>();
  const grow = (id: string, r: Rect) => {
    const cur = bounds.get(id);
    bounds.set(id, cur ? [Math.min(cur[0], r[0]), Math.min(cur[1], r[1]), Math.max(cur[2], r[2]), Math.max(cur[3], r[3])] : [...r]);
  };
  const fitted = new Set<LinePiece>();
  for (const { line, x0, x1, a, b } of fits) {
    const s = (b - a) / (x1 - x0);
    for (const p of line) {
      const r: Rect = [a + (p.r[0] - x0) * s, p.r[1], a + (p.r[2] - x0) * s, p.r[3]];
      if (!pieces.has(p.sid)) pieces.set(p.sid, new Map());
      pieces.get(p.sid)!.set(p.i, r);
      fitted.add(p);
      const bl = blockOf(p.r);
      if (bl) grow(bl.id, r);
    }
  }
  // Blocks are rebuilt from their (corrected) lines, so over-wide OCR blocks shrink too.
  for (const line of lines) for (const p of line) if (!fitted.has(p)) {
    const bl = blockOf(p.r);
    if (bl && bounds.has(bl.id)) grow(bl.id, p.r);
  }
  return pieces.size ? { pieces, blocks: bounds } : null;
}

const tried = new Set<string>();

/** Measures a freshly drawn page once per session and saves the corrected geometry. */
export async function fitPageToInk(paperId: string, index: number, canvas: HTMLCanvasElement) {
  const key = `${paperId}:${index}`;
  if (tried.has(key)) return;
  tried.add(key);
  const rec = await db.models.get(paperId);
  if (!rec || rec.model.pages[index]?.inkFit) return;
  const fit = measureInkFit(rec.model, index, canvas);
  if (!fit) return;
  await db.transaction("rw", db.models, async () => {
    const cur = await db.models.get(paperId);
    const page = cur?.model.pages[index];
    if (!cur || !page || page.inkFit) return;
    for (const [sid, byIdx] of fit.pieces) {
      const s = cur.model.sentences[sid];
      if (!s) continue;
      for (const [i, r] of byIdx) if (s.pieces[i]) s.pieces[i].r = r;
    }
    for (const b of page.blocks) {
      const r = fit.blocks.get(b.id);
      if (r) b.r = r;
    }
    page.inkFit = true;
    await db.models.put(cur);
  });
}
