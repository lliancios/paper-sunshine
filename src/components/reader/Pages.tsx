"use client";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { blit, renderPage, samplePaperColors } from "@/lib/pdf";
import { setFocus } from "@/lib/pipeline";
import { useReader } from "@/store/reader";
import { cx } from "../ui";
import { useReaderData } from "./ReaderData";
import { SourceLayer } from "./SourceLayer";
import { TranslatedLayer } from "./TranslatedLayer";

export function PagesViewport() {
  const { model, paperId } = useReaderData();
  const viewMode = useReader((s) => s.viewMode);
  const zoom = useReader((s) => s.zoom);
  const regionMode = useReader((s) => s.regionMode);
  const set = useReader((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const maxW = Math.max(...model.pages.map((p) => p.w));
  const n = viewMode === "both" ? 2 : 1;
  const fit = width ? Math.max(0.3, (width - 40 - 16 * (n - 1)) / (n * maxW)) : 1;
  const scale = zoom === "fit" ? fit : zoom;

  // Keep the reading position when the scale changes.
  const prevScale = useRef(scale);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && prevScale.current !== scale) {
      const ratio = el.scrollTop / Math.max(1, el.scrollHeight);
      requestAnimationFrame(() => {
        el.scrollTop = ratio * el.scrollHeight;
      });
    }
    prevScale.current = scale;
    set({ scale });
  }, [scale, set]);

  // Current page tracking.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
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
      { root: el, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    el.querySelectorAll("[data-row]").forEach((r) => io.observe(r));
    return () => io.disconnect();
  }, [paperId, set, model.pages.length]);

  // Scroll API used by panels, outline, search and highlights.
  useEffect(() => {
    set({
      scrollToPage: (page: number, y?: number) => {
        const el = ref.current;
        const row = el?.querySelector<HTMLElement>(`[data-row="${page}"]`);
        if (!el || !row) return;
        const s = useReader.getState().scale;
        const top = row.offsetTop + (y !== undefined ? y * s - el.clientHeight * 0.3 : -12);
        el.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      },
    });
    return () => set({ scrollToPage: null });
  }, [set]);

  // Ctrl/⌘ + wheel zoom on desktop.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = useReader.getState().scale;
      const next = Math.min(4, Math.max(0.3, s * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
      set({ zoom: Math.round(next * 100) / 100 });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [set]);

  return (
    <div ref={ref} className={cx("scroll-thin relative h-full overflow-auto bg-reader", regionMode && "ps-region-mode")} data-reader-root>
      <div className="flex flex-col items-center gap-4 px-5 py-5" style={{ minWidth: "fit-content" }}>
        {model.pages.map((p) => (
          <PageRow key={p.i} index={p.i} scale={scale} viewMode={viewMode} />
        ))}
      </div>
    </div>
  );
}

const PageRow = memo(function PageRow({ index, scale, viewMode }: { index: number; scale: number; viewMode: "both" | "src" | "tgt" }) {
  const { model, paperId } = useReaderData();
  const page = model.pages[index];
  const w = Math.round(page.w * scale);
  const h = Math.round(page.h * scale);
  const rowRef = useRef<HTMLDivElement>(null);
  const srcRef = useRef<HTMLCanvasElement>(null);
  const tgtRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [colors, setColors] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const root = el.closest("[data-reader-root]");
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root, rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!near) {
      for (const c of [srcRef.current, tgtRef.current]) if (c) c.width = c.height = 0; // free memory (iPad)
      return;
    }
    const handle = renderPage(paperId, index, scale);
    void handle.promise.then((off) => {
      if (!off) return;
      blit(off, srcRef.current);
      blit(off, tgtRef.current);
      const blocks = page.blocks.filter((b) => b.kind !== "skip").map((b) => ({ id: b.id, r: b.r }));
      setColors(samplePaperColors(off, blocks, off.width / page.w));
      off.width = off.height = 0;
    });
    return () => handle.cancel();
  }, [near, scale, viewMode, paperId, index, page]);

  return (
    <div ref={rowRef} data-row={index} className="flex shrink-0 gap-4" style={{ height: h }}>
      {viewMode !== "tgt" && (
        <div className="relative shrink-0 bg-white shadow-sm ring-1 ring-black/5" style={{ width: w, height: h }}>
          <canvas ref={srcRef} className="absolute inset-0" style={{ width: w, height: h }} />
          {near && <SourceLayer index={index} scale={scale} />}
        </div>
      )}
      {viewMode !== "src" && (
        <div className="relative shrink-0 bg-white shadow-sm ring-1 ring-black/5" style={{ width: w, height: h }}>
          <canvas ref={tgtRef} className="absolute inset-0" style={{ width: w, height: h }} />
          {near && <TranslatedLayer index={index} scale={scale} colors={colors} />}
        </div>
      )}
    </div>
  );
});
