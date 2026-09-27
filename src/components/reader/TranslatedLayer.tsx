"use client";
// Layout translation: each text block of the original page is covered with
// the paper colour and refilled with live, selectable translated text. Every
// sentence keeps its sentence id, so highlights, hover sync, explanations and
// auto highlights work exactly like on the source side.
import { Languages, Loader2 } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block } from "@/engine/types";
import { friendlyError } from "@/lib/api";
import type { Highlight } from "@/lib/db";
import type { InkSpan } from "@/lib/pdf";
import { translateMissing, untranslatedOn } from "@/lib/pipeline";
import { useReader } from "@/store/reader";
import { cx, toast } from "../ui";
import { hlColor, rgba, useReaderData } from "./ReaderData";

export const TranslatedLayer = memo(function TranslatedLayer({
  index,
  scale,
  colors,
  ink,
}: {
  index: number;
  scale: number;
  colors: Map<string, string>;
  ink: Map<string, InkSpan>; // where the printed text really is (scans with an ill-fitting OCR layer)
}) {
  const { model, trans, pagesDone, job } = useReaderData();
  const set = useReader((s) => s.set);
  const last = useRef<string | null>(null);
  const page = model.pages[index];
  const done = pagesDone.has(index);
  const blocks = page.blocks.filter((b) => b.kind !== "skip" && (b.sids.length ? b.sids.some((sid) => trans.has(sid)) : done));
  const pending = !done && page.blocks.some((b) => b.kind !== "skip" && b.sids.length);

  return (
    <div
      className="absolute inset-0 z-[3]"
      data-side="tgt"
      data-page={index}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sent]");
        const sid = el?.dataset.sent ?? null;
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
      {blocks.map((b) => (
        <TBlock key={b.id} block={b} scale={scale} bg={colors.get(b.id) ?? "#ffffff"} ink={ink.get(b.id)} />
      ))}
      {pending && (
        <div className="absolute right-2 top-2 z-[4] inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[11px] text-ink-soft shadow-sm">
          <Loader2 size={11} className="animate-spin" />
          {job?.stage === "error" ? "此頁翻譯失敗，可在論文資訊中重試" : "翻譯中…"}
        </div>
      )}
      {done && <MissingPill index={index} />}
    </div>
  );
});

/** A finished page that still has untranslated (grey) sentences offers to translate just those. */
function MissingPill({ index }: { index: number }) {
  const { model, trans, paperId } = useReaderData();
  const [busy, setBusy] = useState(false);
  const missing = useMemo(() => untranslatedOn(model, index, trans).length, [model, index, trans]);
  if (!missing) return null;
  return (
    <button
      type="button"
      data-popover
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const n = await translateMissing(paperId, index);
          toast(n ? `補翻了 ${n} 句` : "模型這次也沒有翻出來，可以稍後再試");
        } catch (e) {
          toast(`補翻失敗：${friendlyError(e)}`, "error");
        } finally {
          setBusy(false);
        }
      }}
      className="absolute right-2 top-2 z-[4] inline-flex items-center gap-1 rounded-full border border-line bg-white/95 px-2 py-0.5 text-[11px] text-ink-soft shadow-sm hover:text-ink"
      title="這頁有句子還沒翻到（灰色斜體），只補翻這些句子"
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />}
      {busy ? "補翻中…" : `${missing} 句沒翻到 · 補翻`}
    </button>
  );
}

function TBlock({ block, scale, bg, ink }: { block: Block; scale: number; bg: string; ink?: InkSpan }) {
  const { trans } = useReaderData();
  const ref = useRef<HTMLDivElement>(null);
  const pad = block.fs * 0.2;
  const x0 = Math.min(block.r[0], ink?.l ?? Infinity);
  const x1 = Math.max(block.r[2], ink?.r ?? 0);
  const left = (x0 - 1) * scale;
  const top = (block.r[1] - pad) * scale;
  const width = (x1 - x0 + 2) * scale;
  const height = (block.r[3] - block.r[1] + 2 * pad) * scale;
  const lineHeight = block.nl > 1 ? Math.min(1.65, Math.max(1.18, block.lh / block.fs)) : 1.15;
  const maxFs = block.fs * scale * (block.kind === "heading" ? 1 : 0.98);
  const sig = block.sids.map((sid) => trans.get(sid)?.t ?? "").join("|");

  // Shrink-to-fit: binary search the largest font size that fits the box.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.fontSize = `${maxFs}px`;
    if (el.scrollHeight <= el.clientHeight + 1) return;
    let lo = 3;
    let hi = maxFs;
    let best = lo;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      el.style.fontSize = `${mid}px`;
      if (el.scrollHeight <= el.clientHeight + 1) {
        best = mid;
        lo = mid;
      } else hi = mid;
    }
    el.style.fontSize = `${best}px`;
  }, [sig, maxFs, width, height]);

  return (
    <div
      ref={ref}
      className={cx(
        "ps-tblock",
        block.kind === "heading" && "is-heading",
        block.kind === "label" && "is-label",
        block.centered && block.kind !== "para" && "is-centered",
      )}
      style={{ left, top, width, height, background: bg, lineHeight, padding: `${pad * scale * 0.5}px 0`, fontSize: maxFs }}
    >
      {block.sids.map((sid) => (
        <TSentence key={sid} sid={sid} />
      ))}
    </div>
  );
}

function TSentence({ sid }: { sid: string }) {
  const { model, trans, cats, hlBySid, exBySid, settings, catColor } = useReaderData();
  const hover = useReader((s) => s.hoverSid === sid);
  const flashAt = useReader((s) => (s.flash && (s.flash.sid === sid || s.flash.sids?.includes(sid)) ? s.flash.at : 0));
  const focused = useReader((s) => !!s.focus?.sids.includes(sid));
  const showAuto = useReader((s) => s.showAuto);
  const tr = trans.get(sid);
  const text = tr?.t ?? "";
  const fallback = !text;
  const display = fallback ? model.sentences[sid]?.text ?? "" : text;

  const style = useMemo(() => {
    const st: React.CSSProperties = {};
    if (fallback) return { color: "#6b7280", fontStyle: "italic" } as React.CSSProperties;
    const hs = hlBySid.get(sid) ?? [];
    const mirrored = hs.filter((h) => h.side === "src");
    if (mirrored.length) {
      const h = mirrored[mirrored.length - 1];
      const c = hlColor(h.color);
      st.backgroundColor = rgba(c, h.style === "comment" ? 0.14 : 0.22);
      st.textDecorationLine = "underline";
      st.textDecorationStyle = h.style === "comment" ? "dotted" : "dashed";
      st.textDecorationColor = rgba(c, 0.95);
      st.textDecorationThickness = "1.5px";
      st.textUnderlineOffset = "3px";
    } else if (showAuto && settings.autoHighlight && cats.get(sid)) {
      const c = catColor(cats.get(sid)!);
      if (settings.colorScheme === "stroke") {
        st.textDecorationLine = "underline";
        st.textDecorationColor = rgba(c, 0.85);
        st.textDecorationThickness = "2px";
        st.textUnderlineOffset = "3px";
      } else st.backgroundColor = rgba(c, settings.colorScheme === "deep" ? 0.34 : 0.18);
    }
    const ex = (exBySid.get(sid) ?? []).filter((e) => e.side === "src");
    if (ex.length && !st.textDecorationLine) {
      st.textDecorationLine = "underline";
      st.textDecorationStyle = "dotted";
      st.textDecorationColor = "rgba(139,92,246,0.9)";
      st.textUnderlineOffset = "3px";
    }
    st.boxDecorationBreak = "clone";
    st.WebkitBoxDecorationBreak = "clone";
    return st;
  }, [fallback, hlBySid, exBySid, sid, showAuto, settings, cats, catColor]);

  // Split the sentence at the boundaries of highlights drawn on this side.
  const segments = useMemo(() => {
    if (fallback) return [{ a: 0, b: display.length, hs: [] as Highlight[], ex: false }];
    const own = (hlBySid.get(sid) ?? []).filter((h) => h.side === "tgt");
    const ownEx = (exBySid.get(sid) ?? []).filter((e) => e.side === "tgt");
    const cuts = new Set<number>([0, display.length]);
    const ranges: { a: number; b: number; h?: Highlight; ex?: boolean }[] = [];
    for (const h of own)
      for (const r of h.ranges)
        if (r.sid === sid) {
          const a = Math.max(0, Math.min(display.length, r.start));
          const b = Math.max(0, Math.min(display.length, r.end));
          cuts.add(a).add(b);
          ranges.push({ a, b, h });
        }
    for (const e of ownEx)
      for (const r of e.ranges ?? [])
        if (r.sid === sid) {
          cuts.add(Math.min(display.length, r.start)).add(Math.min(display.length, r.end));
          ranges.push({ a: r.start, b: r.end, ex: true });
        }
    const pts = [...cuts].sort((x, y) => x - y);
    const segs: { a: number; b: number; hs: Highlight[]; ex: boolean }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (b <= a) continue;
      const cover = ranges.filter((r) => r.a <= a && r.b >= b);
      segs.push({ a, b, hs: cover.filter((r) => r.h).map((r) => r.h!), ex: cover.some((r) => r.ex) });
    }
    return segs;
  }, [fallback, display, hlBySid, exBySid, sid]);

  const spanRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = spanRef.current;
    if (!el || !flashAt) return;
    el.classList.remove("is-flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("is-flash");
  }, [flashAt]);

  return (
    <span
      ref={spanRef}
      data-sent={sid}
      className={cx("ps-sent", hover && "is-hover", focused && "is-focus")}
      style={{ ...style, userSelect: fallback ? "none" : undefined }}
    >
      {segments.map((sg) => {
        const h = sg.hs[sg.hs.length - 1];
        const segStyle: React.CSSProperties = {};
        if (h) {
          const c = hlColor(h.color);
          segStyle.backgroundColor = rgba(c, h.style === "comment" ? 0.2 : 0.45);
          if (h.style === "comment") {
            segStyle.textDecorationLine = "underline";
            segStyle.textDecorationStyle = "dotted";
            segStyle.textDecorationColor = c;
          }
          segStyle.boxDecorationBreak = "clone";
          segStyle.WebkitBoxDecorationBreak = "clone";
          segStyle.borderRadius = 2;
        }
        if (sg.ex && !segStyle.textDecorationLine) {
          segStyle.textDecorationLine = "underline";
          segStyle.textDecorationStyle = "dotted";
          segStyle.textDecorationColor = "rgba(139,92,246,0.9)";
        }
        return (
          <span key={`${sg.a}-${sg.b}`} data-sid={sid} data-start={sg.a} style={segStyle}>
            {display.slice(sg.a, sg.b)}
          </span>
        );
      })}
    </span>
  );
}
