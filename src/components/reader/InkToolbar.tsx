"use client";
import { Check, Eraser, Eye, EyeOff, Hand, Highlighter, PenLine, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type InkTool, useReader } from "@/store/reader";
import { cx } from "../ui";
import { inkUndo } from "./InkLayer";

const PEN_COLORS = ["#1f2937", "#dc2626", "#2563eb", "#16a34a", "#ea580c"];
const MARKER_COLORS = ["#facc15", "#4ade80", "#f472b6", "#60a5fa", "#fb923c"];
const PEN_SIZES = [1, 1.6, 2.6];
const MARKER_SIZES = [7, 11, 16];

/** Floating palette shown while handwriting mode is on. */
export function InkToolbar() {
  const on = useReader((s) => s.inkMode);
  const ink = useReader((s) => s.ink);
  const showInk = useReader((s) => s.showInk);
  const set = useReader((s) => s.set);
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    setTouch(navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches);
  }, []);

  useEffect(() => {
    if (!on) return;
    document.documentElement.dataset.inkTool = ink.tool;
    return () => {
      delete document.documentElement.dataset.inkTool;
    };
  }, [on, ink.tool]);

  if (!on) return null;
  const marker = ink.tool === "marker";
  const brush = marker ? ink.marker : ink.pen;
  const colors = marker ? MARKER_COLORS : PEN_COLORS;
  const sizes = marker ? MARKER_SIZES : PEN_SIZES;
  const setTool = (tool: InkTool) => set({ ink: { ...ink, tool } });
  const setBrush = (patch: Partial<typeof brush>) =>
    set({ ink: marker ? { ...ink, marker: { ...ink.marker, ...patch } } : { ...ink, pen: { ...ink.pen, ...patch } } });

  const tool = (t: InkTool, title: string, icon: React.ReactNode) => (
    <button
      type="button"
      title={title}
      onClick={() => setTool(t)}
      className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", ink.tool === t ? "bg-accent-soft text-accent-strong" : "text-ink-soft hover:bg-muted")}
    >
      {icon}
    </button>
  );

  return (
    <div
      data-popover
      className="fixed bottom-[max(12px,env(safe-area-inset-bottom))] left-1/2 z-[60] flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-2xl border border-line bg-bg/95 px-2 py-1.5 shadow-[var(--shadow)] backdrop-blur"
    >
      {tool("pen", "筆", <PenLine size={18} />)}
      {tool("marker", "螢光筆", <Highlighter size={18} />)}
      {tool("eraser", "橡皮擦（劃過就刪除整筆）", <Eraser size={18} />)}
      {ink.tool !== "eraser" && (
        <>
          <span className="mx-1 h-6 w-px shrink-0 bg-line" />
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              onClick={() => setBrush({ color: c })}
              className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", brush.color === c && "ring-2 ring-accent ring-offset-1 ring-offset-bg")}
            >
              <span className="h-5 w-5 rounded-full border border-black/10" style={{ background: c }} />
            </button>
          ))}
          <span className="mx-1 h-6 w-px shrink-0 bg-line" />
          {sizes.map((z, i) => (
            <button
              key={z}
              type="button"
              title={["細", "中", "粗"][i]}
              onClick={() => setBrush({ size: z })}
              className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", brush.size === z ? "bg-muted" : "hover:bg-muted")}
            >
              <span className="rounded-full bg-ink" style={{ width: 4 + i * 4, height: 4 + i * 4, opacity: marker ? 0.5 : 1 }} />
            </button>
          ))}
        </>
      )}
      <span className="mx-1 h-6 w-px shrink-0 bg-line" />
      {touch && (
        <button
          type="button"
          title={ink.finger ? "手指也能書寫（兩指捲動）" : "只有 Apple Pencil 書寫，手指捲動"}
          onClick={() => set({ ink: { ...ink, finger: !ink.finger } })}
          className={cx("flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs", ink.finger ? "bg-accent-soft text-accent-strong" : "text-ink-soft hover:bg-muted")}
        >
          <Hand size={16} /> {ink.finger ? "手指書寫" : "只用筆"}
        </button>
      )}
      <button type="button" title="復原（⌘Z）" onClick={() => void inkUndo()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-muted">
        <Undo2 size={18} />
      </button>
      <button
        type="button"
        title={showInk ? "隱藏手寫" : "顯示手寫"}
        onClick={() => set({ showInk: !showInk })}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-muted"
      >
        {showInk ? <Eye size={18} /> : <EyeOff size={18} />}
      </button>
      <button
        type="button"
        onClick={() => set({ inkMode: false })}
        className="ml-1 flex h-9 shrink-0 items-center gap-1 rounded-lg bg-accent px-3 text-sm font-medium text-white hover:bg-accent-strong"
      >
        <Check size={16} /> 完成
      </button>
    </div>
  );
}
