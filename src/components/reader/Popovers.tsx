"use client";
import { Copy, Languages, Loader2, MessageSquarePlus, MessagesSquare, Quote, RefreshCw, ScanSearch, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { aiJson, aiStream } from "@/lib/api";
import type { TranslateResponse } from "@/lib/apiTypes";
import { printedPage, quoteWithCitation } from "@/lib/citation";
import { db, uid } from "@/lib/db";
import { HIGHLIGHT_COLORS } from "@/lib/defaults";
import { renderRegion, thumbnail } from "@/lib/pdf";
import { clearSelection, type SelectionInfo } from "@/lib/selection";
import { useReader } from "@/store/reader";
import { Markdown, copyText, cx, toast } from "../ui";
import { contextFor, createHighlight, overviewText, pageOfRange, softDelete } from "./actions";
import { useReaderData } from "./ReaderData";

function clampPos(x: number, y: number, w: number, h: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return { left: Math.max(8, Math.min(vw - w - 8, x)), top: Math.max(8, Math.min(vh - h - 8, y)) };
}

function belowRect(rect: DOMRect, w: number, h: number) {
  const below = rect.bottom + 10;
  const y = below + h > window.innerHeight - 8 ? rect.top - h - 10 : below;
  return clampPos(rect.left + rect.width / 2 - w / 2, y, w, h);
}

// ------------------------------------------------------ selection bar ----

export function SelectionToolbar() {
  const data = useReaderData();
  const sel = useReader((s) => s.selection);
  const set = useReader((s) => s.set);
  if (!sel) return null;
  const pos = belowRect(sel.rect, 420, 44);
  const page = printedPage(data.paper, data.model, pageOfRange(data.model, sel.side, sel.ranges[0]));

  const done = () => {
    clearSelection();
    set({ selection: null });
  };
  const highlight = async (color: string) => {
    await createHighlight(data.paperId, data.model, sel, color);
    done();
  };

  return (
    <div
      data-popover
      className="fixed z-[60] flex items-center gap-0.5 rounded-xl border border-line bg-bg px-1.5 py-1 shadow-[var(--shadow)]"
      style={pos}
      onPointerDown={(e) => e.preventDefault()}
    >
      {HIGHLIGHT_COLORS.map((c, i) => (
        <button
          key={c.key}
          type="button"
          title={`${c.label}色劃線（${i + 1}）`}
          onClick={() => highlight(c.key)}
          className="m-0.5 h-5 w-5 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110"
          style={{ background: c.color }}
        />
      ))}
      <span className="mx-1 h-5 w-px bg-line" />
      <ToolBtn
        title="評論"
        onClick={async () => {
          const id = await createHighlight(data.paperId, data.model, sel, "yellow", "comment");
          set({ highlightPop: { id, x: sel.rect.left, y: sel.rect.bottom + 12, editNote: true } });
          done();
        }}
      >
        <MessageSquarePlus size={16} />
      </ToolBtn>
      <ToolBtn title="解釋" onClick={() => (set({ explain: { kind: "text", selection: sel } }), done())}>
        <Sparkles size={16} /> <span className="text-xs">解釋</span>
      </ToolBtn>
      {sel.side === "src" && (
        <ToolBtn title="翻譯（T）" onClick={() => (set({ translatePop: sel }), done())}>
          <Languages size={16} />
        </ToolBtn>
      )}
      <ToolBtn title="複製" onClick={() => (copyText(sel.text), done())}>
        <Copy size={16} />
      </ToolBtn>
      <ToolBtn title="複製引用（APA）" onClick={() => (copyText(quoteWithCitation(sel.text, data.paper, page), "已複製引用"), done())}>
        <Quote size={16} />
      </ToolBtn>
    </div>
  );
}

function ToolBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-ink-soft hover:bg-muted hover:text-ink">
      {children}
    </button>
  );
}

// ------------------------------------------------- existing highlight ----

export function HighlightPopover() {
  const data = useReaderData();
  const pop = useReader((s) => s.highlightPop);
  const set = useReader((s) => s.set);
  const h = data.highlights.find((x) => x.id === pop?.id);
  const [note, setNote] = useState(h?.note ?? "");
  useEffect(() => setNote(h?.note ?? ""), [h?.id, h?.note]);
  if (!pop || !h) return null;
  const pos = clampPos(pop.x - 150, pop.y + 14, 300, pop.editNote || h.note ? 230 : 120);
  const page = printedPage(data.paper, data.model, h.page);
  const counterpart =
    h.side === "src"
      ? h.ranges.map((r) => data.trans.get(r.sid)?.t ?? "").join("")
      : h.ranges.map((r) => data.model.sentences[r.sid]?.text ?? "").join(" ");
  const saveNote = async () => {
    if (note !== h.note) await db.highlights.update(h.id, { note, updatedAt: Date.now() });
  };
  return (
    <div data-popover className="fixed z-[60] w-[300px] rounded-xl border border-line bg-bg p-3 shadow-[var(--shadow)]" style={pos}>
      <div className="mb-2 flex items-center gap-1">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            title={c.label}
            onClick={() => db.highlights.update(h.id, { color: c.key, updatedAt: Date.now() })}
            className={cx("h-5 w-5 rounded-full ring-1 ring-black/10", h.color === c.key && "ring-2 ring-ink")}
            style={{ background: c.color }}
          />
        ))}
        <div className="ml-auto flex">
          <ToolBtn title="複製引用" onClick={() => copyText(quoteWithCitation(h.text, data.paper, page), "已複製引用")}>
            <Quote size={15} />
          </ToolBtn>
          <ToolBtn
            title="刪除"
            onClick={async () => {
              await softDelete("highlights", h.id);
              set({ highlightPop: null });
            }}
          >
            <Trash2 size={15} />
          </ToolBtn>
          <ToolBtn title="關閉" onClick={() => (void saveNote(), set({ highlightPop: null }))}>
            <X size={15} />
          </ToolBtn>
        </div>
      </div>
      {counterpart && <div className="mb-2 line-clamp-3 rounded-lg bg-muted px-2 py-1.5 text-xs text-ink-soft">{counterpart}</div>}
      <textarea
        autoFocus={pop.editNote}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={saveNote}
        placeholder="寫下評論…"
        className="h-20 w-full resize-none rounded-lg border border-line bg-bg p-2 text-sm outline-none focus:border-accent"
      />
    </div>
  );
}

// ----------------------------------------------------------- explain ----

export function ExplainPopover() {
  const data = useReaderData();
  const req = useReader((s) => s.explain);
  const set = useReader((s) => s.set);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const started = useRef<SelectionInfo | null>(null);

  useEffect(() => {
    if (!req || started.current === req.selection) return;
    started.current = req.selection;
    const sel = req.selection;
    const ctrl = new AbortController();
    setAnswer("");
    setErr("");
    setBusy(true);
    const sids = sel.ranges.map((r) => r.sid);
    aiStream(
      {
        task: "explain",
        targetLanguage: data.settings.targetLanguage,
        paperTitle: data.paper.title,
        overview: overviewText(data.overview),
        researchContext: data.settings.researchContext,
        selection: sel.text,
        context: contextFor(data.model, sids),
        side: sel.side,
        model: data.settings.modelChat || undefined,
      },
      setAnswer,
      ctrl.signal,
    )
      .then(async (full) => {
        const now = Date.now();
        await db.explanations.put({
          id: uid(),
          paperId: data.paperId,
          kind: "text",
          side: sel.side,
          ranges: sel.ranges,
          page: pageOfRange(data.model, sel.side, sel.ranges[0]),
          query: sel.text,
          answer: full,
          createdAt: now,
          updatedAt: now,
        });
      })
      .catch((e) => !ctrl.signal.aborted && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  if (!req) return null;
  const pos = belowRect(req.selection.rect, 420, 360);
  return (
    <div data-popover className="fixed z-[60] flex max-h-[60vh] w-[420px] max-w-[calc(100vw-16px)] flex-col rounded-2xl border border-line bg-bg shadow-[var(--shadow)]" style={pos}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Sparkles size={16} className="text-violet-500" />
        <div className="line-clamp-1 flex-1 text-sm font-medium">{req.selection.text}</div>
        {busy && <Loader2 size={15} className="animate-spin text-ink-faint" />}
        <button type="button" title="關閉" onClick={() => (started.current = null, set({ explain: null }))} className="text-ink-faint hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin overflow-y-auto px-4 py-3">
        {err ? <div className="text-sm text-red-600">{err}</div> : answer ? <Markdown>{answer}</Markdown> : <div className="ps-shimmer h-16 rounded-lg" />}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-muted"
          onClick={() => set({ explain: null, rightTab: "ai", chatDraft: `關於「${req.selection.text.slice(0, 120)}」：` })}
        >
          <MessagesSquare size={14} /> 在討論中追問
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------- translate ----

export function TranslatePopover() {
  const data = useReaderData();
  const sel = useReader((s) => s.translatePop);
  const set = useReader((s) => s.set);
  const [busy, setBusy] = useState(false);
  if (!sel) return null;
  const rows = sel.ranges.map((r) => ({ sid: r.sid, en: data.model.sentences[r.sid]?.text ?? "", zh: data.trans.get(r.sid)?.t ?? "" }));
  const missing = rows.filter((r) => !r.zh);
  const pos = belowRect(sel.rect, 440, 260);
  const translateNow = async () => {
    setBusy(true);
    try {
      const res = await aiJson<TranslateResponse>({
        task: "translate",
        paperTitle: data.paper.title,
        blocks: [{ kind: "para", sentences: missing.map((m) => ({ id: m.sid, text: m.en })) }],
        glossary: data.overview?.glossary ?? [],
        rolePrompt: data.settings.rolePrompt,
        targetLanguage: data.settings.targetLanguage,
        categories: data.settings.categories,
        autoHighlight: false,
        model: data.settings.modelTranslate || undefined,
      });
      await db.translations.bulkPut(
        res.items.map((i) => ({ paperId: data.paperId, sid: i.id, page: data.model.sentences[i.id]?.p ?? 0, t: i.t, c: data.trans.get(i.id)?.c ?? null, mock: res.mock })),
      );
    } catch (e) {
      toast(`翻譯失敗：${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-popover className="fixed z-[60] flex max-h-[50vh] w-[440px] max-w-[calc(100vw-16px)] flex-col rounded-2xl border border-line bg-bg shadow-[var(--shadow)]" style={pos}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium">
        <Languages size={16} className="text-accent-strong" /> 對照翻譯
        <button type="button" title="關閉" onClick={() => set({ translatePop: null })} className="ml-auto text-ink-faint hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {rows.map((r) => (
          <div key={r.sid}>
            <div className="text-ink-soft">{r.en}</div>
            <div className="mt-1">{r.zh || <span className="text-ink-faint">尚未翻譯</span>}</div>
          </div>
        ))}
      </div>
      {!!missing.length && (
        <div className="border-t border-line px-3 py-2 text-right">
          <button type="button" disabled={busy} onClick={translateNow} className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1 text-xs text-bg">
            {busy && <Loader2 size={12} className="animate-spin" />} 立即翻譯這幾句
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ figure ----

export function FigurePanel() {
  const data = useReaderData();
  const fig = useReader((s) => s.figure);
  const set = useReader((s) => s.set);
  const [img, setImg] = useState<{ base64: string; dataUrl: string } | null>(null);
  const [answer, setAnswer] = useState("");
  const [mode, setMode] = useState<"figure" | "model" | null>(null);
  const [busy, setBusy] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setImg(null);
    setAnswer("");
    setMode(null);
    ctrlRef.current?.abort();
    if (!fig) return;
    let alive = true;
    void renderRegion(data.paperId, fig.page, fig.rect).then((r) => alive && setImg(r));
    return () => {
      alive = false;
    };
  }, [fig, data.paperId]);

  if (!fig) return null;
  const run = async (task: "figure" | "model") => {
    if (!img) return;
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setMode(task);
    setAnswer("");
    setBusy(true);
    try {
      const full = await aiStream(
        {
          task,
          targetLanguage: data.settings.targetLanguage,
          paperTitle: data.paper.title,
          overview: overviewText(data.overview),
          researchContext: data.settings.researchContext,
          image: img.base64,
          caption: fig.caption,
          model: data.settings.modelChat || undefined,
        },
        setAnswer,
        ctrl.signal,
      );
      const now = Date.now();
      await db.explanations.put({
        id: uid(),
        paperId: data.paperId,
        kind: task,
        page: fig.page,
        rect: fig.rect,
        thumb: await thumbnail(img.dataUrl),
        query: `${task === "model" ? "研究概念模型分析" : "解讀這張圖"}${fig.caption ? `：${fig.caption.slice(0, 80)}` : ""}`,
        answer: full,
        createdAt: now,
        updatedAt: now,
      });
    } catch (e) {
      if (!ctrl.signal.aborted) setAnswer(`**錯誤**：${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-popover className="fixed right-4 top-20 z-[60] flex max-h-[calc(100vh-100px)] w-[420px] max-w-[calc(100vw-32px)] flex-col rounded-2xl border border-line bg-bg shadow-[var(--shadow)]">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-sm font-medium">
        <ScanSearch size={16} className="text-violet-500" /> 圖片說明
        <span className="text-xs font-normal text-ink-faint">第 {printedPage(data.paper, data.model, fig.page) ?? fig.page + 1} 頁</span>
        <button type="button" title="重新框選" onClick={() => set({ figure: null, regionMode: true })} className="ml-auto text-ink-faint hover:text-ink">
          <RefreshCw size={15} />
        </button>
        <button type="button" title="關閉" onClick={() => (ctrlRef.current?.abort(), set({ figure: null }))} className="text-ink-faint hover:text-ink">
          <X size={16} />
        </button>
      </div>
      <div className="scroll-thin overflow-y-auto p-4">
        <div className="mb-3 overflow-hidden rounded-lg border border-dashed border-violet-300 bg-white">
          {img ? <img src={img.dataUrl} alt="選取的圖" className="w-full" /> : <div className="ps-shimmer h-40" />}
        </div>
        <div className="mb-3 flex gap-2">
          <button
            type="button"
            disabled={!img || busy}
            onClick={() => run("figure")}
            className={cx("flex-1 rounded-xl border px-3 py-2 text-sm font-medium", mode === "figure" ? "border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-950" : "border-line hover:bg-muted")}
          >
            解讀這張圖
          </button>
          <button
            type="button"
            disabled={!img || busy}
            onClick={() => run("model")}
            className={cx("flex-1 rounded-xl border px-3 py-2 text-sm font-medium", mode === "model" ? "border-violet-400 bg-violet-50 text-violet-700 dark:bg-violet-950" : "border-line hover:bg-muted")}
          >
            研究概念模型分析
          </button>
        </div>
        {busy && !answer && <div className="ps-shimmer h-20 rounded-lg" />}
        {answer && <Markdown>{answer}</Markdown>}
      </div>
    </div>
  );
}
