"use client";
// Maps a DOM selection (or a caret position) inside either text layer to
// sentence ranges. Every selectable text node lives in an element carrying
// data-sid and data-start (offset of its first char inside the sentence),
// and each side is wrapped in an element with data-side="src" | "tgt".
import type { SentRange, Side } from "@/engine/types";

export interface SelectionInfo {
  side: Side;
  ranges: SentRange[];
  text: string;
  rect: DOMRect;
  page: number;
}

function segOf(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el && !(el instanceof HTMLElement && el.dataset.sid !== undefined && el.dataset.start !== undefined)) el = el.parentNode;
  return el as HTMLElement | null;
}

function sideOf(node: Node | null): { side: Side; page: number } | null {
  let el: Node | null = node;
  while (el) {
    if (el instanceof HTMLElement && el.dataset.side) return { side: el.dataset.side as Side, page: Number(el.dataset.page ?? 0) };
    el = el.parentNode;
  }
  return null;
}

/** All sentence segments (in DOM order) within a container. */
function segmentsIn(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-sid][data-start]"));
}

function pointToOffset(node: Node, offset: number, atEnd: boolean): { seg: HTMLElement; off: number } | null {
  const seg = segOf(node);
  if (seg) {
    if (node.nodeType === Node.TEXT_NODE) return { seg, off: Number(seg.dataset.start) + offset };
    // element boundary: offset counts child nodes
    const len = seg.textContent?.length ?? 0;
    return { seg, off: Number(seg.dataset.start) + (offset === 0 ? 0 : len) };
  }
  // Boundary sits between segments: snap to the nearest segment.
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!el) return null;
  const child = (el as Element).childNodes[offset] as Node | undefined;
  const probe = atEnd ? (child?.previousSibling ?? child ?? null) : (child ?? null);
  if (probe) {
    const inner = probe instanceof Element ? (atEnd ? segmentsIn(probe).pop() : segmentsIn(probe)[0]) ?? segOf(probe) : segOf(probe);
    if (inner) return { seg: inner, off: Number(inner.dataset.start) + (atEnd ? (inner.textContent?.length ?? 0) : 0) };
  }
  return null;
}

export function readSelection(): SelectionInfo | null {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const s = sideOf(range.startContainer);
  const e = sideOf(range.endContainer);
  if (!s || !e || s.side !== e.side) return null;
  const start = pointToOffset(range.startContainer, range.startOffset, false);
  const end = pointToOffset(range.endContainer, range.endOffset, true);
  if (!start || !end) return null;

  // Walk every segment between start and end in document order.
  const root = document.querySelector(`[data-reader-root]`) ?? document.body;
  const all = segmentsIn(root).filter((el) => sideOf(el)?.side === s.side);
  const i0 = all.indexOf(start.seg);
  const i1 = all.indexOf(end.seg);
  if (i0 < 0 || i1 < 0 || i1 < i0) return null;
  const bySid = new Map<string, SentRange>();
  const order: string[] = [];
  for (let i = i0; i <= i1; i++) {
    const el = all[i];
    const sid = el.dataset.sid!;
    const segStart = Number(el.dataset.start);
    const segEnd = segStart + (el.textContent?.length ?? 0);
    const a = i === i0 ? start.off : segStart;
    const b = i === i1 ? end.off : segEnd;
    if (b <= a) continue;
    const cur = bySid.get(sid);
    if (cur) {
      cur.start = Math.min(cur.start, a);
      cur.end = Math.max(cur.end, b);
    } else {
      bySid.set(sid, { sid, start: a, end: b });
      order.push(sid);
    }
  }
  const ranges = order.map((sid) => bySid.get(sid)!);
  if (!ranges.length) return null;
  // Collapse layout whitespace, but keep real spaces (translations contain English terms).
  const text = sel
    .toString()
    .replace(/\s+/g, " ")
    .replace(/([\u3000-\u9fff\uff00-\uffef]) (?=[\u3000-\u9fff\uff00-\uffef])/g, "$1")
    .trim();
  return { side: s.side, ranges, text, rect: range.getBoundingClientRect(), page: s.page };
}

/** Sentence + offset under a screen point (for clicking existing highlights). */
export function caretAt(x: number, y: number): { side: Side; sid: string; off: number; page: number } | null {
  let node: Node | null = null;
  let offset = 0;
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    if (p) (node = p.offsetNode), (offset = p.offset);
  } else if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    if (r) (node = r.startContainer), (offset = r.startOffset);
  }
  if (!node) return null;
  const seg = segOf(node);
  const s = sideOf(node);
  if (!seg || !s) return null;
  return { side: s.side, sid: seg.dataset.sid!, off: Number(seg.dataset.start) + (node.nodeType === Node.TEXT_NODE ? offset : 0), page: s.page };
}

export function clearSelection() {
  window.getSelection()?.removeAllRanges();
}
