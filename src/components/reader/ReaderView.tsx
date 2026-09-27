"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { printedPage } from "@/lib/citation";
import { db } from "@/lib/db";
import { HIGHLIGHT_COLORS } from "@/lib/defaults";
import { enqueue } from "@/lib/pipeline";
import { caretAt, clearSelection, readSelection } from "@/lib/selection";
import { useReader } from "@/store/reader";
import { ErrorBoundary } from "../ErrorBoundary";
import { LeftSidebar } from "../LeftSidebar";
import { RelatedPanel, SavedPanel } from "../WorkPanels";
import { SunMark } from "../SunMark";
import { cx, toast } from "../ui";
import { createHighlight, quickHighlight } from "./actions";
import { inkUndo } from "./InkLayer";
import { InkToolbar } from "./InkToolbar";
import { PagesViewport } from "./Pages";
import { OnePagerModal } from "./OnePager";
import { ExplainPopover, FigurePanel, HighlightPopover, SelectionToolbar, TranslatePopover } from "./Popovers";
import { type ReaderData, ReaderDataProvider, scrollToSentences, useLoadReaderData } from "./ReaderData";
import { RightPanel, RightRail } from "./RightSidebar";
import { Toolbar } from "./Toolbar";

export function ReaderView({ paperId }: { paperId: string }) {
  const data = useLoadReaderData(paperId);
  const paper = useLiveQuery(() => db.papers.get(paperId), [paperId]);
  const job = useLiveQuery(() => db.jobs.get(paperId), [paperId]);

  useEffect(() => {
    void (async () => {
      const p = await db.papers.get(paperId);
      // Opening a batch-imported paper starts its full translation.
      await db.papers.update(paperId, { lastOpenedAt: Date.now(), ...(p?.triage ? { triage: false, updatedAt: Date.now() } : {}) });
      enqueue(paperId, true);
    })();
    useReader.getState().set({
      selection: null,
      explain: null,
      figure: null,
      highlightPop: null,
      translatePop: null,
      relatedOpen: false,
      savedOpen: false,
      regionMode: false,
      onepagerOpen: false,
      inkMode: false,
      focus: null,
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
        <Loader2 className="mr-2 animate-spin" size={18} /> {job?.note || (job?.stage === "parsing" ? "解析 PDF 版面中…" : "載入中…")}
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

  // Resume where this paper was last read (on any device), then keep the position saved.
  const currentPage = useReader((s) => s.currentPage);
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) return;
    resumed.current = true;
    const last = data.paper.readPage ?? 0;
    if (last > 0 && last < data.model.pages.length) {
      setTimeout(() => {
        useReader.getState().scrollToPage?.(last);
        const p = printedPage(data.paper, data.model, last) ?? String(last + 1);
        toast(`接續上次閱讀的位置：p.${p}`);
      }, 350);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!resumed.current) return;
    const t = setTimeout(() => {
      const d = dataRef.current;
      if (d.paper.readPage !== currentPage) void db.papers.update(d.paperId, { readPage: currentPage, updatedAt: Date.now() });
    }, 2500);
    return () => clearTimeout(t);
  }, [currentPage]);

  // Selection, click-on-highlight, double-click quick highlight, and keyboard shortcuts for both sides.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let suppressSelUntil = 0;
    let lastTap: { t: number; x: number; y: number; sid: string } | null = null;
    const onSelChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (Date.now() < suppressSelUntil) return;
        const s = readSelection();
        if (s) useReader.getState().set({ selection: s, highlightPop: null });
      }, 160);
    };
    // Double-click (or double-tap) a sentence: highlight the whole sentence in the quick colour.
    const quick = async (sid: string, side: "src" | "tgt") => {
      const d = dataRef.current;
      suppressSelUntil = Date.now() + 600;
      clearSelection();
      useReader.getState().set({ selection: null });
      if (d.highlights.some((h) => h.style === "highlight" && h.ranges.some((r) => r.sid === sid))) return;
      await quickHighlight(d.paperId, d.model, sid, side, d.trans.get(sid)?.t, d.settings.quickColor || "green");
    };
    const onDblClick = (e: MouseEvent) => {
      const st = useReader.getState();
      if (st.inkMode || st.regionMode) return;
      const t = e.target as HTMLElement;
      if (t.closest("[data-popover]") || !t.closest("[data-side]")) return;
      const hit = caretAt(e.clientX, e.clientY);
      if (hit) void quick(hit.sid, hit.side);
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
      if (useReader.getState().inkMode) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const st = useReader.getState();
      if (!t.closest("[data-side]")) {
        if (st.highlightPop) st.set({ highlightPop: null });
        return;
      }
      const hit = caretAt(e.clientX, e.clientY);
      if (!hit) return st.set({ highlightPop: null });
      if (e.pointerType !== "mouse") {
        // Touch has no reliable dblclick: two taps on the same sentence within 350 ms.
        const now = Date.now();
        if (lastTap && now - lastTap.t < 350 && lastTap.sid === hit.sid && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
          lastTap = null;
          void quick(hit.sid, hit.side);
          return;
        }
        lastTap = { t: now, x: e.clientX, y: e.clientY, sid: hit.sid };
      }
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
      if (st.inkMode) {
        if (e.key === "Escape") st.set({ inkMode: false });
        else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          void inkUndo();
        }
        return;
      }
      if (e.key === "Escape") {
        clearSelection();
        st.set({ selection: null, explain: null, translatePop: null, highlightPop: null, figure: null, regionMode: false, focus: null });
        return;
      }
      // ← / → step through the summary's citations while one is in focus.
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && st.focus?.trail && !st.selection) {
        const t = st.focus.trail;
        const i = t.index + (e.key === "ArrowLeft" ? -1 : 1);
        if (i >= 0 && i < t.list.length) {
          e.preventDefault();
          scrollToSentences(dataRef.current.model, t.list[i], dataRef.current.paper, { list: t.list, index: i });
        }
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
    document.addEventListener("dblclick", onDblClick);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("dblclick", onDblClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden">
      {leftOpen && (
        <div className="relative hidden h-full md:block">
          <ErrorBoundary label="左側欄" compact>
            <LeftSidebar paperId={data.paperId} onCollapse={() => set({ leftOpen: false })} />
          </ErrorBoundary>
        </div>
      )}
      <div className="relative flex min-w-0 flex-1 flex-col">
        <ErrorBoundary label="工具列" compact>
          <Toolbar />
        </ErrorBoundary>
        <div className={cx("flex min-h-0 flex-1", bottom ? "flex-col" : "flex-row")}>
          <div className="relative min-h-0 min-w-0 flex-1">
            <ErrorBoundary label="論文頁面">
              <PagesViewport />
            </ErrorBoundary>
            {relatedOpen && (
              <ErrorBoundary label="相關論文" compact>
                <RelatedPanel paperId={data.paperId} />
              </ErrorBoundary>
            )}
            {savedOpen && (
              <ErrorBoundary label="已儲存" compact>
                <SavedPanel />
              </ErrorBoundary>
            )}
          </div>
          <RightPanel />
        </div>
      </div>
      <RightRail />
      <ErrorBoundary silent label="選取工具列">
        <SelectionToolbar />
      </ErrorBoundary>
      <ErrorBoundary silent label="劃線視窗">
        <HighlightPopover />
      </ErrorBoundary>
      <ErrorBoundary silent label="解釋視窗">
        <ExplainPopover />
      </ErrorBoundary>
      <ErrorBoundary silent label="翻譯視窗">
        <TranslatePopover />
      </ErrorBoundary>
      <ErrorBoundary silent label="圖片說明">
        <FigurePanel />
      </ErrorBoundary>
      <ErrorBoundary label="一頁速覽" compact>
        <OnePagerModal />
      </ErrorBoundary>
      <ErrorBoundary silent label="手寫工具">
        <InkToolbar />
      </ErrorBoundary>
    </div>
  );
}
