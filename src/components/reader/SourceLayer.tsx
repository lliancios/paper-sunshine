"use client";
// Source (original PDF) side: highlight marks under a transparent, selectable
// text layer whose spans carry sentence ids and offsets.
import { Sparkles } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import { rectsForRange } from "@/engine/geometry";
import type { Block, Rect } from "@/engine/types";
import { useReader } from "@/store/reader";
import { hlColor, rgba, useReaderData } from "./ReaderData";

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, px: number): number {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * px * 0.5;
  measureCtx.font = `${px}px sans-serif`;
  return measureCtx.measureText(text).width;
}

interface Mark {
  r: Rect;
  style: React.CSSProperties;
  cls?: string;
}

export const SourceLayer = memo(function SourceLayer({ index, scale }: { index: number; scale: number }) {
  return (
    <>
      <StaticMarks index={index} scale={scale} />
      <HoverMarks index={index} scale={scale} />
      <TextLayer index={index} scale={scale} />
      <CaptionButtons index={index} scale={scale} />
      <RegionSelect index={index} scale={scale} />
    </>
  );
});

function StaticMarks({ index, scale }: { index: number; scale: number }) {
  const { model, trans, highlights, explanations, settings, catColor, pagesDone } = useReaderData();
  const showAuto = useReader((s) => s.showAuto);
  const scheme = settings.colorScheme;

  const marks = useMemo(() => {
    const out: Mark[] = [];
    const onPage = (sid: string) => model.sentences[sid]?.pieces.some((p) => p.p === index);
    // auto highlights: whole sentences
    if (showAuto && settings.autoHighlight) {
      for (const [sid, t] of trans) {
        if (!t.c || !onPage(sid)) continue;
        const s = model.sentences[sid];
        const color = catColor(t.c);
        for (const r of rectsForRange(s, 0, s.text.length, index)) {
          out.push({
            r,
            cls: scheme === "stroke" ? undefined : "ps-mark",
            style:
              scheme === "stroke"
                ? { borderBottom: `2px solid ${rgba(color, 0.85)}` }
                : { background: rgba(color, scheme === "deep" ? 0.34 : 0.18) },
          });
        }
      }
    }
    // user highlights: precise on this side, whole sentence when drawn on the translation
    for (const h of highlights) {
      const color = hlColor(h.color);
      for (const range of h.ranges) {
        const s = model.sentences[range.sid];
        if (!s || !onPage(range.sid)) continue;
        const mirrored = h.side === "tgt";
        const rects = mirrored ? rectsForRange(s, 0, s.text.length, index) : rectsForRange(s, range.start, range.end, index);
        for (const r of rects) {
          out.push({
            r,
            cls: "ps-mark",
            style:
              h.style === "comment"
                ? { background: rgba(color, 0.18), borderBottom: `2px dotted ${rgba(color, 0.95)}` }
                : mirrored
                  ? { background: rgba(color, 0.22), borderBottom: `1.5px dashed ${rgba(color, 0.9)}` }
                  : { background: rgba(color, 0.42) },
          });
        }
      }
    }
    // text explanations: dotted violet underline
    for (const e of explanations) {
      for (const range of e.ranges ?? []) {
        const s = model.sentences[range.sid];
        if (!s || !onPage(range.sid)) continue;
        const rects = e.side === "tgt" ? rectsForRange(s, 0, s.text.length, index) : rectsForRange(s, range.start, range.end, index);
        for (const r of rects) out.push({ r, style: { borderBottom: "2px dotted rgba(139,92,246,0.9)" } });
      }
    }
    // saved figure regions
    for (const e of explanations) {
      if (e.kind === "text" || e.page !== index || !e.rect) continue;
      out.push({ r: e.rect, style: { border: "1.5px dashed rgba(139,92,246,0.7)", borderRadius: 6 } });
    }
    return out;
    // pagesDone keeps auto marks fresh as pages finish
  }, [model, trans, highlights, explanations, index, showAuto, settings.autoHighlight, scheme, catColor, pagesDone]);

  return (
    <div className="ps-marks">
      {marks.map((m, i) => (
        <div
          key={i}
          className={m.cls}
          style={{
            left: m.r[0] * scale - 1,
            top: m.r[1] * scale - 1,
            width: (m.r[2] - m.r[0]) * scale + 2,
            height: (m.r[3] - m.r[1]) * scale + 2,
            ...m.style,
          }}
        />
      ))}
    </div>
  );
}

function HoverMarks({ index, scale }: { index: number; scale: number }) {
  const { model } = useReaderData();
  const hoverSid = useReader((s) => s.hoverSid);
  const flash = useReader((s) => s.flash);
  const rects = useMemo(() => {
    const s = hoverSid ? model.sentences[hoverSid] : null;
    return s ? rectsForRange(s, 0, s.text.length, index) : [];
  }, [hoverSid, model, index]);
  const flashRects = useMemo(() => {
    const s = flash?.sid ? model.sentences[flash.sid] : null;
    return s ? rectsForRange(s, 0, s.text.length, index) : [];
  }, [flash, model, index]);
  return (
    <div className="ps-marks">
      {rects.map((r, i) => (
        <div key={`h${i}`} className="ps-hover" style={{ left: r[0] * scale - 2, top: r[1] * scale - 2, width: (r[2] - r[0]) * scale + 4, height: (r[3] - r[1]) * scale + 4 }} />
      ))}
      {flashRects.map((r, i) => (
        <div
          key={`f${flash?.at}-${i}`}
          className="ps-flash"
          style={{ left: r[0] * scale - 2, top: r[1] * scale - 2, width: (r[2] - r[0]) * scale + 4, height: (r[3] - r[1]) * scale + 4 }}
        />
      ))}
    </div>
  );
}

function TextLayer({ index, scale }: { index: number; scale: number }) {
  const { model, piecesByPage } = useReaderData();
  const set = useReader((s) => s.set);
  const last = useRef<string | null>(null);
  const spans = useMemo(() => {
    const list = piecesByPage.get(index) ?? [];
    return list.map(({ sid, pc }) => {
      const text = model.sentences[sid].text.slice(pc.s, pc.e);
      const px = Math.max(1, pc.fs * scale);
      const target = (pc.r[2] - pc.r[0]) * scale;
      const w = measure(text, px);
      const sx = w > 0 ? target / w : 1;
      return { sid, start: pc.s, text, left: pc.r[0] * scale, top: pc.r[1] * scale, px, sx };
    });
  }, [piecesByPage, index, model, scale]);

  return (
    <div
      className="ps-textlayer"
      data-side="src"
      data-page={index}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const sid = (e.target as HTMLElement).dataset?.sid ?? null;
        if (sid !== last.current) {
          last.current = sid;
          set({ hoverSid: sid });
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse") return; // touch "leave" fires on lift; keep the tapped sentence pinned
        last.current = null;
        set({ hoverSid: null });
      }}
    >
      {spans.map((s, i) => (
        <span
          key={i}
          data-sid={s.sid}
          data-start={s.start}
          style={{ left: s.left, top: s.top, fontSize: s.px, transform: `scaleX(${s.sx})` }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------ figure helpers ----

const FIG_RE = /^(fig\.?|figure|table|exhibit|chart)\s*[\dA-Z]/i;

export function figureRegion(blocks: Block[], cap: Block, W: number, H: number): Rect {
  const narrow = cap.r[2] - cap.r[0] < 0.55 * W;
  const x0 = narrow ? (cap.r[0] + cap.r[2]) / 2 < W / 2 ? 0.04 * W : W / 2 : 0.04 * W;
  const x1 = narrow ? ((cap.r[0] + cap.r[2]) / 2 < W / 2 ? W / 2 : 0.96 * W) : 0.96 * W;
  const overl = (b: Block) => Math.min(b.r[2], x1) - Math.max(b.r[0], x0) > 0;
  const textish = (b: Block) => (b.kind === "para" && b.nl >= 2) || (b.kind === "heading" && b.fs > cap.fs * 1.05);
  const above = blocks.filter((b) => b !== cap && overl(b) && textish(b) && b.r[3] <= cap.r[1] + 1).sort((a, b) => b.r[3] - a.r[3])[0];
  const below = blocks.filter((b) => b !== cap && overl(b) && textish(b) && b.r[1] >= cap.r[3] - 1).sort((a, b) => a.r[1] - b.r[1])[0];
  // Running headers/footers bound the region too.
  const headerBottom = Math.max(0.04 * H, ...blocks.filter((b) => b.kind === "skip" && b.r[3] < 0.12 * H).map((b) => b.r[3] + 4));
  const footerTop = Math.min(0.96 * H, ...blocks.filter((b) => b.kind === "skip" && b.r[1] > 0.88 * H).map((b) => b.r[1] - 4));
  const upTop = above ? above.r[3] + 2 : headerBottom;
  const downBottom = below ? below.r[1] - 2 : footerTop;
  const labelsIn = (y0: number, y1: number) => blocks.filter((b) => b.kind === "label" && b.r[1] >= y0 && b.r[3] <= y1 && overl(b)).length;
  const upLabels = labelsIn(upTop, cap.r[1]);
  const downLabels = labelsIn(cap.r[3], downBottom);
  const upArea = cap.r[1] - upTop;
  const downArea = downBottom - cap.r[3];
  const useUp = upLabels !== downLabels ? upLabels > downLabels : upArea >= downArea;
  return useUp ? [x0, upTop, x1, cap.r[3] + 2] : [x0, cap.r[1] - 2, x1, downBottom];
}

function CaptionButtons({ index, scale }: { index: number; scale: number }) {
  const { model } = useReaderData();
  const set = useReader((s) => s.set);
  const page = model.pages[index];
  const caps = page.blocks.filter((b) => b.kind === "caption" && FIG_RE.test(b.sids.map((s) => model.sentences[s]?.text).join(" ")));
  return (
    <>
      {caps.map((b) => {
        const caption = b.sids.map((s) => model.sentences[s]?.text).join(" ");
        return (
          <button
            key={b.id}
            type="button"
            className="absolute z-[4] inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white/95 px-2 py-0.5 text-[11px] font-medium text-violet-700 shadow-sm hover:bg-violet-50"
            style={{ left: Math.max(2, b.r[0] * scale - 4), top: Math.max(2, b.r[1] * scale - 24) }}
            onClick={() => set({ figure: { page: index, rect: figureRegion(page.blocks, b, page.w, page.h), caption } })}
          >
            <Sparkles size={12} /> 解讀這張圖
          </button>
        );
      })}
    </>
  );
}

function RegionSelect({ index, scale }: { index: number; scale: number }) {
  const regionMode = useReader((s) => s.regionMode);
  const set = useReader((s) => s.set);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  if (!regionMode) return null;
  const pos = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <div
      className="absolute inset-0 z-[5] cursor-crosshair bg-violet-500/5"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const p = pos(e);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = pos(e);
        setDrag({ ...drag, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (!drag) return;
        const x0 = Math.min(drag.x0, drag.x1) / scale;
        const y0 = Math.min(drag.y0, drag.y1) / scale;
        const x1 = Math.max(drag.x0, drag.x1) / scale;
        const y1 = Math.max(drag.y0, drag.y1) / scale;
        setDrag(null);
        if (x1 - x0 > 12 && y1 - y0 > 12) set({ figure: { page: index, rect: [x0, y0, x1, y1] }, regionMode: false });
      }}
    >
      {drag && (
        <div
          className="absolute border-2 border-dashed border-violet-500 bg-violet-400/10"
          style={{
            left: Math.min(drag.x0, drag.x1),
            top: Math.min(drag.y0, drag.y1),
            width: Math.abs(drag.x1 - drag.x0),
            height: Math.abs(drag.y1 - drag.y0),
          }}
        />
      )}
    </div>
  );
}
