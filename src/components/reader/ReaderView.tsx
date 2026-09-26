"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { db } from "@/lib/db";
import { HIGHLIGHT_COLORS } from "@/lib/defaults";
import { enqueue } from "@/lib/pipeline";
import { caretAt, clearSelection, readSelection } from "@/lib/selection";
import { useReader } from "@/store/reader";
import { LeftSidebar } from "../LeftSidebar";
import { RelatedPanel, SavedPanel } from "../WorkPanels";
import { SunMark } from "../SunMark";
import { cx } from "../ui";
import { createHighlight } from "./actions";
import { PagesViewport } from "./Pages";
import { ExplainPopover, FigurePanel, HighlightPopover, SelectionToolbar, TranslatePopover } from "./Popovers";
import { type ReaderData, ReaderDataProvider, useLoadReaderData } from "./ReaderData";
import { RightPanel, RightRail } from "./RightSidebar";
import { Toolbar } from "./Toolbar";

export function ReaderView({ paperId }: { paperId: string }) {
  const data = useLoadReaderData(paperId);
  const paper = useLiveQuery(() => db.papers.get(paperId), [paperId]);
  const job = useLiveQuery(() => db.jobs.get(paperId), [paperId]);

  useEffect(() => {
    void db.papers.update(paperId, { lastOpenedAt: Date.now() });
    enqueue(paperId, true);
    useReader.getState().set({
      selection: null,
      explain: null,
      figure: null,
      highlightPop: null,
      translatePop: null,
      relatedOpen: false,
      savedOpen: false,
      regionMode: false,
      currentPage: 0,
    });
  }, [paperId]);

  if (data === "missing") return <Centered>找不到這篇論文。<Link href="/" className="ml-2 text-accent-strong underline">回文獻庫</Link></Centered>;
  if (paper && !paper.hasFile)
    return (
      <Centered>
        <div className="max-w-md text-center">
          <div className="mb-2 font-semibold">{paper.title}</div>
          <p className="text-sm text-ink-soft">這一筆還沒有 PDF。用學校 VPN 下載後拖進文獻庫，會依 DOI 自動配對。</p>
          {paper.doi && (
            <a className="mt-3 inline-flex items-center gap-1 text-sm text-accent-strong" href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> 開啟 DOI 頁面
            </a>
          )}
        </div>
      </Centered>
    );
  if (!data)
    return (
      <Centered>
        <Loader2 className="mr-2 animate-spin" size={18} /> {job?.stage === "parsing" ? "解析 PDF 版面中…" : "載入中…"}
      </Centered>
    );
  return (
    <ReaderDataProvider value={data}>
      <ReaderShell data={data} />
    </ReaderDataProvider>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 text-ink-soft">
      <SunMark size={40} />
      <div className="flex items-center">{children}</div>
    </div>
  );
}

function ReaderShell({ data }: { data: ReaderData }) {
  const leftOpen = useReader((s) => s.leftOpen);
  const relatedOpen = useReader((s) => s.relatedOpen);
  const savedOpen = useReader((s) => s.savedOpen);
  const bottom = useReader((s) => s.sidebarBottom);
  const set = useReader((s) => s.set);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const w = window.innerWidth;
    if (w < 1280) set({ leftOpen: false }); // iPad: give the pages the room
    if (w < 900) set({ viewMode: "tgt" }); // phone: translation only
  }, [set]);

  // Selection, click-on-highlight, and keyboard shortcuts for both sides.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSelChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const s = readSelection();
        if (s) useReader.getState().set({ selection: s, highlightPop: null });
      }, 160);
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-popover]")) return;
      const st = useReader.getState();
      if (st.selection) st.set({ selection: null });
    };
    const onPointerUp = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-popover]")) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const st = useReader.getState();
      if (!t.closest("[data-side]")) {
        if (st.highlightPop) st.set({ highlightPop: null });
        return;
      }
      const hit = caretAt(e.clientX, e.clientY);
      if (!hit) return st.set({ highlightPop: null });
      const d = dataRef.current;
      const h = [...d.highlights].reverse().find((x) =>
        x.ranges.some((r) => r.sid === hit.sid && (x.side !== hit.side || (hit.off >= r.start && hit.off <= r.end))),
      );
      if (h) {
        st.set({ highlightPop: { id: h.id, x: e.clientX, y: e.clientY }, hoverSid: hit.sid });
        return;
      }
      // Touch: tapping a sentence pins it on both sides.
      st.set({ highlightPop: null, ...(e.pointerType !== "mouse" ? { hoverSid: st.hoverSid === hit.sid ? null : hit.sid } : {}) });
    };
    const onKey = (e: KeyboardEvent) => {
      const st = useReader.getState();
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "Escape") {
        clearSelection();
        st.set({ selection: null, explain: null, translatePop: null, highlightPop: null, figure: null, regionMode: false });
        return;
      }
      const sel = st.selection;
      if (!sel || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "t" || e.key === "T") && sel.side === "src") {
        st.set({ translatePop: sel, selection: null });
        clearSelection();
      } else if (e.key === "e" || e.key === "E") {
        st.set({ explain: { kind: "text", selection: sel }, selection: null });
        clearSelection();
      } else if (/^[1-5]$/.test(e.key)) {
        const c = HIGHLIGHT_COLORS[Number(e.key) - 1];
        void createHighlight(dataRef.current.paperId, dataRef.current.model, sel, c.key);
        st.set({ selection: null });
        clearSelection();
      }
    };
    document.addEventListener("selectionchange", onSelChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden">
      {leftOpen && (
        <div className="relative hidden h-full md:block">
          <LeftSidebar paperId={data.paperId} onCollapse={() => set({ leftOpen: false })} />
        </div>
      )}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <Toolbar />
        <div className={cx("flex min-h-0 flex-1", bottom ? "flex-col" : "flex-row")}>
          <div className="relative min-h-0 min-w-0 flex-1">
            <PagesViewport />
            {relatedOpen && <RelatedPanel paperId={data.paperId} />}
            {savedOpen && <SavedPanel />}
          </div>
          <RightPanel />
        </div>
      </div>
      <RightRail />
      <SelectionToolbar />
      <HighlightPopover />
      <ExplainPopover />
      <TranslatePopover />
      <FigurePanel />
    </div>
  );
}
