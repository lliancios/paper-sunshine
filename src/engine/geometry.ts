import { charBoundaries } from "./charwidth";
import type { Piece, Rect, Sentence } from "./types";

/** x position of sentence offset `k` inside piece `pc`. */
function xAt(sentence: Sentence, pc: Piece, k: number): number {
  if (k <= pc.s) return pc.r[0];
  if (k >= pc.e) return pc.r[2];
  const b = charBoundaries(sentence.text.slice(pc.s, pc.e), pc.r[0], pc.r[2]);
  return b[k - pc.s];
}

/**
 * Rectangles covering [start, end) of a sentence on one page. Adjacent pieces
 * on the same line are merged so highlights span the gaps between words.
 */
export function rectsForRange(sentence: Sentence, start: number, end: number, page: number): Rect[] {
  const raw: Rect[] = [];
  for (const pc of sentence.pieces) {
    if (pc.p !== page) continue;
    const a = Math.max(start, pc.s);
    const b = Math.min(end, pc.e);
    if (a >= b) continue;
    raw.push([xAt(sentence, pc, a), pc.r[1], xAt(sentence, pc, b), pc.r[3]]);
  }
  return mergeRects(raw);
}

export function mergeRects(rects: Rect[]): Rect[] {
  if (rects.length < 2) return rects;
  const out: Rect[] = [];
  for (const r of rects) {
    const prev = out[out.length - 1];
    if (prev) {
      const h = Math.min(prev[3] - prev[1], r[3] - r[1]);
      const vOverlap = Math.min(prev[3], r[3]) - Math.max(prev[1], r[1]);
      const gap = r[0] - prev[2];
      if (vOverlap > 0.5 * h && gap > -h && gap < 1.2 * h) {
        prev[0] = Math.min(prev[0], r[0]);
        prev[1] = Math.min(prev[1], r[1]);
        prev[2] = Math.max(prev[2], r[2]);
        prev[3] = Math.max(prev[3], r[3]);
        continue;
      }
    }
    out.push([...r] as Rect);
  }
  return out;
}

/** Bounding box of a sentence on a page (for scrolling / figure regions). */
export function sentenceBox(sentence: Sentence, page?: number): Rect | null {
  let box: Rect | null = null;
  for (const pc of sentence.pieces) {
    if (page !== undefined && pc.p !== page) continue;
    if (!box) box = [...pc.r] as Rect;
    else {
      box[0] = Math.min(box[0], pc.r[0]);
      box[1] = Math.min(box[1], pc.r[1]);
      box[2] = Math.max(box[2], pc.r[2]);
      box[3] = Math.max(box[3], pc.r[3]);
    }
  }
  return box;
}

export function pagesOf(sentence: Sentence): number[] {
  return [...new Set(sentence.pieces.map((p) => p.p))];
}
