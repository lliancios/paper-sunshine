"use client";
// Split view: the original and the translation live in two independent
// scroll panes. Both panes lay pages out with identical geometry, so keeping
// them aligned is just copying scrollTop/scrollLeft from the pane you are
// touching to the other one. Zoom in and the right pane still shows the same
// corner of the same page as the left pane.
import { ChevronLeft, ChevronRight, MapPin, Undo2, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Side } from "@/engine/types";
import { acquireRender, blit, samplePaperColors } from "@/lib/pdf";
import { setFocus } from "@/lib/pipeline";
import { useReader } from "@/store/reader";
import { cx } from "../ui";
import { clearFocus, scrollToSentences, useReaderData } from "./ReaderData";
import { SourceLayer } from "./SourceLayer";
import { TranslatedLayer } from "./TranslatedLayer";
import { InkLayer } from "./InkLayer";

const PANE_PAD = 20;

export function PagesViewport() {
  const { model, paperId } = useReaderData();
  const viewMode = useReader((s) => s.viewMode);
  const zoom = useReader((s) => s.zoom);
  const regionMode = useReader((s) => s.regionMode);
  const set = useReader((s) => s.set);
  const outer = useRef<HTMLDivElement>(null);
  const panes = useRef<(HTMLDivElement | null)[]>([]);
  const leader = useRef(0);
  const [width, setWidth] = useState(0);
  const sides: Side[] = viewMode === "both" ? ["src", "tgt"] : [viewMode];

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const maxW = Math.max(...model.pages.map((p) => p.w));
  const paneW = width / sides.length;
  const fit = width ? Math.max(0.3, (paneW - 2 * PANE_PAD - 10) / maxW) : 1;
  const scale = zoom === "fit" ? fit : zoom;

  // Keep the reading position when the scale changes.
  const prevScale = useRef(scale);
  useLayoutEffect(() => {
    const el = panes.current[leader.current] ?? panes.current[0];
    if (el && prevScale.current !== scale) {
      const ry = el.scrollTop / Math.max(1, el.scrollHeight);
      const rx = el.scrollLeft / Math.max(1, el.scrollWidth);
      requestAnimationFrame(() => {
        el.scrollTop = ry * el.scrollHeight;
        el.scrollLeft = rx * el.scrollWidth;
      });
    }
    prevScale.current = scale;
    set({ scale });
  }, [scale, set]);

  // Mirror scroll from the pane being touched to the others.
  const onScroll = useCallback((i: number) => {
    if (i !== leader.current) return;
    const src = panes.current[i];
    if (!src) return;
    panes.current.forEach((p, j) => {
      if (!p || j === i) return;
      if (p.scrollTop !== src.scrollTop) p.scrollTop = src.scrollTop;
      if (p.scrollLeft !== src.scrollLeft) p.scrollLeft = src.scrollLeft;
    });
  }, []);

  // Current page tracking on the first pane.
  useEffect(() => {
    const root = panes.current[0];
    if (!root) return;
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.row), e.intersectionRatio);
        let best = 0;
        let br = -1;
        for (const [p, r] of ratios) if (r > br || (r === br && p < best)) (best = p), (br = r);
        if (br > 0) {
          set({ currentPage: best });
          setFocus(paperId, best);
        }
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    root.querySelectorAll("[data-row]").forEach((r) => io.observe(r));
    return () => io.disconnect();
  }, [paperId, set, model.pages.length, viewMode]);

  // Scroll API used by panels, outline, search and highlights.
  useEffect(() => {
    set({
      scrollToPage: (page: number, y?: number, x?: number) => {
        const i = panes.current[leader.current] ? leader.current : 0;
        const el = panes.current[i];
        const row = el?.querySelector<HTMLElement>(`[data-row="${page}"]`);
        if (!el || !row) return;
        leader.current = i;
        const s = useReader.getState().scale;
        const top = row.offsetTop + (y !== undefined ? y * s - el.clientHeight * 0.3 : -12);
        // When zoomed in, also bring the right column into view.
        const left = x !== undefined && el.scrollWidth > el.clientWidth ? row.offsetLeft + x * s - el.clientWidth * 0.2 : el.scrollLeft;
        el.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: "smooth" });
      },
      getScrollPos: () => {
        const el = panes.current[leader.current] ?? panes.current[0];
        return { top: el?.scrollTop ?? 0, left: el?.scrollLeft ?? 0 };
      },
      setScrollPos: (pos) => {
        const i = panes.current[leader.current] ? leader.current : 0;
        leader.current = i;
        panes.current[i]?.scrollTo({ top: pos.top, left: pos.left, behavior: "smooth" });
      },
    });
    return () => set({ scrollToPage: null, getScrollPos: null, setScrollPos: null });
  }, [set]);

  // Ctrl/⌘ + wheel zoom on desktop.
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = useReader.getState().scale;
      set({ zoom: Math.round(Math.min(4, Math.max(0.3, s * (e.deltaY < 0 ? 1.08 : 1 / 1.08))) * 100) / 100 });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [set]);

  return (
    <div ref={outer} className={cx("flex h-full bg-reader", regionMode && "ps-region-mode")} data-reader-root>
      {sides.map((side, i) => (
        <div
          key={side}
          ref={(el) => {
            panes.current[i] = el;
          }}
          onScroll={() => onScroll(i)}
          onPointerEnter={() => (leader.current = i)}
          onPointerDown={() => (leader.current = i)}
          onTouchStart={() => (leader.current = i)}
          onWheel={() => (leader.current = i)}
          className={cx("scroll-thin relative h-full min-w-0 flex-1 overflow-auto", i > 0 && "border-l border-line")}
          style={{ overscrollBehavior: "contain", touchAction: "manipulation" }}
        >
          <div className="flex flex-col items-center gap-4" style={{ padding: PANE_PAD, minWidth: "fit-content" }}>
            {model.pages.map((p) => (
              <PageBox key={p.i} index={p.i} scale={scale} side={side} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const PageBox = memo(function PageBox({ index, scale, side }: { index: number; scale: number; side: Side }) {
  const { model, paperId } = useReaderData();
  const page = model.pages[index];
  const w = Math.round(page.w * scale);
  const h = Math.round(page.h * scale);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [colors, setColors] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const root = el.closest<HTMLElement>(".overflow-auto");
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root, rootMargin: "900px 400px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!near) {
      if (c) c.width = c.height = 0; // free memory (iPad)
      return;
    }
    const r = acquireRender(paperId, index, scale);
    let alive = true;
    void r.promise.then((off) => {
      if (!off || !alive) return r.release();
      blit(off, canvasRef.current);
      if (side === "tgt") {
        const blocks = page.blocks.filter((b) => b.kind !== "skip").map((b) => ({ id: b.id, r: b.r }));
        setColors(samplePaperColors(off, blocks, off.width / page.w));
      }
      r.release();
    });
    return () => {
      alive = false;
      r.release();
    };
  }, [near, scale, paperId, index, page, side]);

  return (
    <div ref={boxRef} data-row={index} className="relative shrink-0 bg-white shadow-sm ring-1 ring-black/5" style={{ width: w, height: h }}>
      <canvas ref={canvasRef} className="absolute inset-0" style={{ width: w, height: h }} />
      {near && (side === "src" ? <SourceLayer index={index} scale={scale} /> : <TranslatedLayer index={index} scale={scale} colors={colors} />)}
      {near && <InkLayer index={index} side={side} />}
      {near && <FocusTag index={index} scale={scale} side={side} />}
    </div>
  );
});

/** "p.71 左欄第 12 行" tag above the first cited line, with a way back. Shown in the first pane only. */
function FocusTag({ index, scale, side }: { index: number; scale: number; side: Side }) {
  const { model, paper } = useReaderData();
  const focus = useReader((s) => (s.focus && s.focus.page === index ? s.focus : null));
  const firstPane = useReader((s) => s.viewMode !== "both" || side === "src");
  if (!focus || !firstPane) return null;
  const pc = model.sentences[focus.sids[0]]?.pieces.find((p) => p.p === index);
  if (!pc) return null;
  const top = Math.max(4, pc.r[1] * scale - 30);
  const left = Math.max(4, pc.r[0] * scale - 4);
  return (
    <div className="ps-focus-tag" style={{ top, left }} data-popover>
      <MapPin size={12} />
      <span className="px-1 font-medium">{focus.label}</span>
      {focus.trail && focus.trail.list.length > 1 && (
        <>
          <button
            type="button"
            title="上一個出處"
            disabled={focus.trail.index === 0}
            className="disabled:opacity-40"
            onClick={() => {
              const t = focus.trail!;
              scrollToSentences(model, t.list[t.index - 1], paper, { list: t.list, index: t.index - 1 });
            }}
          >
            <ChevronLeft size={13} />
          </button>
          <span className="tabular-nums text-[11px] opacity-90">
            {focus.trail.index + 1}/{focus.trail.list.length}
          </span>
          <button
            type="button"
            title="下一個出處"
            disabled={focus.trail.index >= focus.trail.list.length - 1}
            className="disabled:opacity-40"
            onClick={() => {
              const t = focus.trail!;
              scrollToSentences(model, t.list[t.index + 1], paper, { list: t.list, index: t.index + 1 });
            }}
          >
            <ChevronRight size={13} />
          </button>
        </>
      )}
      {focus.back && (
        <button type="button" title="回到跳轉前閱讀的位置" onClick={() => clearFocus(true)}>
          <Undo2 size={12} /> 回原處
        </button>
      )}
      <button type="button" title="取消標示（Esc）" onClick={() => clearFocus(false)}>
        <X size={12} />
      </button>
    </div>
  );
}
