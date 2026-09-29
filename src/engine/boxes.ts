// Where each translated block is drawn on the translated side (page units).
// Starts from the block's own rect (widened to the printed ink on scans),
// then guarantees that no two boxes overlap: a box painted over a neighbour
// would hide that neighbour's text. Pure, so `npm test` checks it on every page.
import type { Block, Rect } from "./types";

export type InkSpan = { l: number; r: number };

const GAP = 0.6; // page units kept free between two boxes

function overlap(a: Rect, b: Rect) {
  return Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0;
}

/** Final box per block id: the block rect plus a little padding, widened to its ink, never overlapping another box or leaving the page. */
export function layoutBoxes(blocks: Block[], ink: Map<string, InkSpan> | undefined, pageW: number, pageH: number): Map<string, Rect> {
  const items = blocks.map((b) => {
    const pad = b.fs * 0.2;
    const x0 = Math.min(b.r[0], ink?.get(b.id)?.l ?? Infinity);
    const x1 = Math.max(b.r[2], ink?.get(b.id)?.r ?? 0);
    const box: Rect = [Math.max(0, x0 - 1), Math.max(0, b.r[1] - pad), Math.min(pageW, x1 + 1), Math.min(pageH, b.r[3] + pad)];
    return { id: b.id, o: b.r, box };
  });
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!overlap(a.box, b.box)) continue;
        changed = true;
        // Decide the cut from the original rects: side by side → vertical cut, stacked → horizontal cut.
        const ox = Math.min(a.o[2], b.o[2]) - Math.max(a.o[0], b.o[0]);
        const oy = Math.min(a.o[3], b.o[3]) - Math.max(a.o[1], b.o[1]);
        const sideBySide = ox <= 0 || (oy > 0 && ox / Math.min(a.o[2] - a.o[0], b.o[2] - b.o[0]) < oy / Math.min(a.o[3] - a.o[1], b.o[3] - b.o[1]));
        if (sideBySide) {
          const [L, R] = (a.o[0] + a.o[2]) / 2 <= (b.o[0] + b.o[2]) / 2 ? [a, b] : [b, a];
          // Cut in the middle of the gap between the original texts (or of their overlap).
          const cut = ox <= 0 ? (L.o[2] + R.o[0]) / 2 : (Math.max(L.o[0], R.o[0]) + Math.min(L.o[2], R.o[2])) / 2;
          L.box[2] = Math.min(L.box[2], cut - GAP / 2);
          R.box[0] = Math.max(R.box[0], cut + GAP / 2);
        } else {
          const [T, B] = (a.o[1] + a.o[3]) / 2 <= (b.o[1] + b.o[3]) / 2 ? [a, b] : [b, a];
          const cut = oy <= 0 ? (T.o[3] + B.o[1]) / 2 : (Math.max(T.o[1], B.o[1]) + Math.min(T.o[3], B.o[3])) / 2;
          T.box[3] = Math.min(T.box[3], cut - GAP / 2);
          B.box[1] = Math.max(B.box[1], cut + GAP / 2);
        }
        // Never invert a box: keep at least a sliver so the text shrinks instead of spilling.
        for (const it of [a, b]) {
          if (it.box[2] - it.box[0] < 2) it.box[2] = it.box[0] + 2;
          if (it.box[3] - it.box[1] < 2) it.box[3] = it.box[1] + 2;
        }
      }
    }
    if (!changed) break;
  }
  return new Map(items.map((it) => [it.id, it.box]));
}

/** Pairs of boxes that still overlap (for tests). */
export function overlappingBoxes(boxes: Map<string, Rect>): [string, string][] {
  const list = [...boxes];
  const out: [string, string][] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (overlap(list[i][1], list[j][1])) out.push([list[i][0], list[j][0]]);
  return out;
}
