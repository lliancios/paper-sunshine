"use client";
// Handwriting layer (Apple Pencil, finger or mouse). One SVG per page and side,
// in PDF page units, so strokes stay attached to the page at any zoom and in
// both panes. On iPad, only the Pencil draws by default: stylus touches are
// claimed with preventDefault while fingers keep scrolling.
import { useLiveQuery } from "dexie-react-hooks";
import { getStroke } from "perfect-freehand";
import { memo, useEffect, useMemo, useRef } from "react";
import type { Side } from "@/engine/types";
import { type InkStroke, db, uid } from "@/lib/db";
import { useReader } from "@/store/reader";
import { useReaderData } from "./ReaderData";

// ------------------------------------------------------------- geometry ----

type Pt = [number, number, number];

function toPoints(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i], flat[i + 1], flat[i + 2]]);
  return out;
}

/** Mouse and finger report a constant pressure; simulate it from speed instead. */
function flatPressure(pts: Pt[]) {
  return pts.every((p) => Math.abs(p[2] - pts[0][2]) < 0.001);
}

function svgPath(outline: number[][]): string {
  if (outline.length < 4) return "";
  const avg = (a: number, b: number) => ((a + b) / 2).toFixed(2);
  let [a, b, c] = outline;
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${avg(b[0], c[0])},${avg(b[1], c[1])} T`;
  for (let i = 2; i < outline.length - 1; i++) {
    a = outline[i];
    b = outline[i + 1];
    d += `${avg(a[0], b[0])},${avg(a[1], b[1])} `;
  }
  return d + "Z";
}

export function strokeToPath(pts: Pt[], tool: InkStroke["tool"], size: number, last = true): string {
  if (!pts.length) return "";
  const input = pts.length === 1 ? [pts[0], [pts[0][0] + 0.01, pts[0][1] + 0.01, pts[0][2]] as Pt] : pts;
  const marker = tool === "marker";
  const outline = getStroke(input, {
    size: marker ? size : size * 1.8,
    thinning: marker ? 0 : 0.6,
    smoothing: 0.55,
    streamline: marker ? 0.6 : 0.4,
    simulatePressure: flatPressure(pts),
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
    last,
  });
  return svgPath(outline);
}

const pathCache = new Map<string, string>();
function cachedPath(s: InkStroke): string {
  const key = `${s.id}:${s.updatedAt}`;
  let d = pathCache.get(key);
  if (d === undefined) {
    d = strokeToPath(toPoints(s.pts), s.tool, s.size);
    if (pathCache.size > 4000) pathCache.clear();
    pathCache.set(key, d);
  }
  return d;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hits(s: InkStroke, x: number, y: number, r: number) {
  const reach = r + s.size / 2;
  const p = s.pts;
  if (p.length < 6) return Math.hypot(p[0] - x, p[1] - y) < reach;
  for (let i = 0; i + 5 < p.length; i += 3) if (distToSegment(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) < reach) return true;
  return false;
}

// ----------------------------------------------------------------- undo ----

type UndoStep = { kind: "add"; ids: string[] } | { kind: "erase"; ids: string[] };
const undoStack: UndoStep[] = [];

export async function inkUndo() {
  const step = undoStack.pop();
  if (!step) return false;
  const now = Date.now();
  await db.ink.bulkUpdate(step.ids.map((id) => ({ key: id, changes: { deleted: step.kind === "add", updatedAt: now } })));
  return true;
}
export const canUndoInk = () => undoStack.length > 0;

// ---------------------------------------------------------------- layer ----

export const InkLayer = memo(function InkLayer({ index, side }: { index: number; side: Side }) {
  const { paperId, model } = useReaderData();
  const page = model.pages[index];
  const inkMode = useReader((s) => s.inkMode);
  const showInk = useReader((s) => s.showInk);
  const strokes = useLiveQuery(
    () =>
      db.ink
        .where("[paperId+page]")
        .equals([paperId, index])
        .filter((s) => !s.deleted)
        .sortBy("createdAt"),
    [paperId, index],
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const liveRef = useRef<SVGPathElement>(null);
  const pending = useRef<string | null>(null);
  const strokesRef = useRef<InkStroke[]>([]);
  strokesRef.current = strokes ?? [];

  // Drop the live preview once the saved stroke shows up from IndexedDB (no flicker).
  useEffect(() => {
    if (pending.current && strokes?.some((s) => s.id === pending.current)) {
      liveRef.current?.setAttribute("d", "");
      pending.current = null;
    }
  }, [strokes]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !inkMode || !showInk) return;

    let active: number | null = null;
    let pts: Pt[] = [];
    let erased: string[] = [];
    let raf = 0;

    const brush = () => {
      const ink = useReader.getState().ink;
      return ink.tool === "marker" ? { tool: "marker" as const, ...ink.marker } : { tool: "pen" as const, ...ink.pen };
    };
    const toPage = (e: PointerEvent): Pt => {
      const r = svg.getBoundingClientRect();
      const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
      return [
        Math.round(((e.clientX - r.left) / r.width) * page.w * 10) / 10,
        Math.round(((e.clientY - r.top) / r.height) * page.h * 10) / 10,
        Math.round(pressure * 100) / 100,
      ];
    };
    const allowed = (e: PointerEvent) => {
      if (e.pointerType === "pen") {
        // A Pencil is in use: fingers go back to scrolling (palm rejection).
        const ink = useReader.getState().ink;
        if (ink.finger) useReader.getState().set({ ink: { ...ink, finger: false } });
        return true;
      }
      if (e.pointerType === "mouse") return e.button === 0;
      return useReader.getState().ink.finger && e.isPrimary;
    };
    const draw = () => {
      raf = 0;
      const b = brush();
      liveRef.current?.setAttribute("d", strokeToPath(pts, b.tool, b.size, false));
    };
    const eraseAt = (p: Pt) => {
      const r = 6;
      const now = Date.now();
      const victims = strokesRef.current.filter((s) => !erased.includes(s.id) && hits(s, p[0], p[1], r));
      if (!victims.length) return;
      erased.push(...victims.map((v) => v.id));
      void db.ink.bulkUpdate(victims.map((v) => ({ key: v.id, changes: { deleted: true, updatedAt: now } })));
    };

    const onDown = (e: PointerEvent) => {
      if (active !== null || !allowed(e)) return;
      e.preventDefault();
      active = e.pointerId;
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const p = toPage(e);
      if (useReader.getState().ink.tool === "eraser") {
        erased = [];
        eraseAt(p);
        return;
      }
      pts = [p];
      const b = brush();
      const live = liveRef.current;
      if (live) {
        live.setAttribute("fill", b.color);
        live.setAttribute("opacity", b.tool === "marker" ? "0.38" : "1");
        live.style.mixBlendMode = b.tool === "marker" ? "multiply" : "normal";
      }
      draw();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      e.preventDefault();
      const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      const list = events.length ? events : [e];
      if (useReader.getState().ink.tool === "eraser") {
        for (const ev of list) eraseAt(toPage(ev));
        return;
      }
      for (const ev of list) pts.push(toPage(ev));
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = null;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (useReader.getState().ink.tool === "eraser") {
        if (erased.length) undoStack.push({ kind: "erase", ids: erased });
        erased = [];
        return;
      }
      if (e.type === "pointercancel" && pts.length < 3) {
        liveRef.current?.setAttribute("d", "");
        pts = [];
        return;
      }
      const b = brush();
      const now = Date.now();
      const stroke: InkStroke = {
        id: uid(),
        paperId,
        page: index,
        side,
        tool: b.tool,
        color: b.color,
        size: b.size,
        pts: pts.flat(),
        createdAt: now,
        updatedAt: now,
      };
      liveRef.current?.setAttribute("d", strokeToPath(pts, b.tool, b.size, true));
      pending.current = stroke.id;
      pts = [];
      undoStack.push({ kind: "add", ids: [stroke.id] });
      if (undoStack.length > 200) undoStack.shift();
      void db.ink.add(stroke);
    };
    // iPadOS: claim Pencil touches so they draw instead of scrolling; fingers
    // still scroll unless finger writing is on.
    const onTouch = (e: TouchEvent) => {
      const finger = useReader.getState().ink.finger;
      const stylus = Array.from(e.touches).some((t) => (t as Touch & { touchType?: string }).touchType === "stylus");
      if (stylus || (finger && e.touches.length === 1)) e.preventDefault();
    };

    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
    svg.addEventListener("touchstart", onTouch, { passive: false });
    svg.addEventListener("touchmove", onTouch, { passive: false });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      svg.removeEventListener("pointerdown", onDown);
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
      svg.removeEventListener("touchstart", onTouch);
      svg.removeEventListener("touchmove", onTouch);
    };
  }, [inkMode, showInk, page.w, page.h, paperId, index, side]);

  const paths = useMemo(() => (strokes ?? []).map((s) => ({ s, d: cachedPath(s) })), [strokes]);
  if (!inkMode && (!showInk || !paths.length)) return null;

  return (
    <svg
      ref={svgRef}
      data-ink={index}
      className={inkMode && showInk ? "ps-ink is-active" : "ps-ink"}
      viewBox={`0 0 ${page.w} ${page.h}`}
      preserveAspectRatio="none"
    >
      {showInk &&
        paths.map(({ s, d }) => {
          const mine = s.side === side;
          const marker = s.tool === "marker";
          return (
            <path
              key={s.id}
              d={d}
              fill={s.color}
              opacity={marker ? (mine ? 0.38 : 0.16) : mine ? 1 : 0.28}
              style={marker ? { mixBlendMode: "multiply" } : undefined}
            />
          );
        })}
      <path ref={liveRef} />
    </svg>
  );
});
