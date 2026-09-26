"use client";
import { useLiveQuery } from "dexie-react-hooks";
import {
  BookMarked,
  Gamepad2,
  Highlighter,
  Loader2,
  MessageSquare,
  NotebookPen,
  PanelBottom,
  PanelRight,
  ScrollText,
  Send,
  Sparkles,
  Telescope,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { aiJson, aiStream, friendlyError, postJson } from "@/lib/api";
import type { QuizQuestion, WorkMeta } from "@/lib/apiTypes";
import { printedPage, quoteWithCitation } from "@/lib/citation";
import { type Highlight, db, uid } from "@/lib/db";
import { HIGHLIGHT_COLORS } from "@/lib/defaults";
import { models } from "@/lib/settings";
import { type RightTab, useReader } from "@/store/reader";
import { ErrorBoundary } from "../ErrorBoundary";
import { WorkCard } from "../WorkPanels";
import { Badge, Button, IconButton, Markdown, Segmented, copyText, cx, relTime, toast } from "../ui";
import { fullText, overviewText, softDelete } from "./actions";
import { CitedMarkdown, OnePagerPanel } from "./OnePager";
import { paperLines } from "@/lib/pipeline";
import { hlColor, scrollToSentence, useReaderData } from "./ReaderData";

const RAIL: { key: RightTab; label: string; icon: React.ReactNode }[] = [
  { key: "onepager", label: "一頁速覽", icon: <ScrollText size={19} /> },
  { key: "ai", label: "與 AI 一起", icon: <WandSparkles size={19} /> },
  { key: "quiz", label: "測驗", icon: <Gamepad2 size={19} /> },
  { key: "highlights", label: "高亮", icon: <Highlighter size={19} /> },
  { key: "explanations", label: "解釋", icon: <Sparkles size={19} /> },
  { key: "comments", label: "評論", icon: <MessageSquare size={19} /> },
  { key: "notes", label: "筆記", icon: <NotebookPen size={19} /> },
  { key: "citations", label: "引用卡片", icon: <BookMarked size={19} /> },
];

export function RightRail() {
  const data = useReaderData();
  const tab = useReader((s) => s.rightTab);
  const bottom = useReader((s) => s.sidebarBottom);
  const set = useReader((s) => s.set);
  const counts: Partial<Record<RightTab, number>> = {
    highlights: data.highlights.filter((h) => h.style === "highlight").length,
    explanations: data.explanations.length,
    comments: data.highlights.filter((h) => h.note).length,
  };
  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-l border-line bg-bg py-3">
      {RAIL.map((r) => (
        <button
          key={r.key}
          type="button"
          title={r.label}
          onClick={() => set({ rightTab: tab === r.key ? null : r.key })}
          className={cx("relative flex h-10 w-10 items-center justify-center rounded-xl text-ink-soft hover:bg-muted hover:text-ink", tab === r.key && "bg-accent-soft text-accent-strong")}
        >
          {r.icon}
          {!!counts[r.key] && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-ink px-1 text-[10px] font-semibold leading-4 text-bg">{counts[r.key]}</span>
          )}
        </button>
      ))}
      <button
        type="button"
        title="相關論文"
        onClick={() => set({ relatedOpen: !useReader.getState().relatedOpen, savedOpen: false })}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-ink-soft hover:bg-muted hover:text-ink"
      >
        <Telescope size={19} />
      </button>
      <div className="mt-auto">
        <IconButton title={bottom ? "將側邊欄移到右側" : "將側邊欄移到底部"} onClick={() => set({ sidebarBottom: !bottom })}>
          {bottom ? <PanelRight size={18} /> : <PanelBottom size={18} />}
        </IconButton>
      </div>
    </div>
  );
}

export function RightPanel() {
  const tab = useReader((s) => s.rightTab);
  const bottom = useReader((s) => s.sidebarBottom);
  const set = useReader((s) => s.set);
  const width = useReader((s) => s.panelWidth);
  if (!tab) return null;
  const label = RAIL.find((r) => r.key === tab)?.label;
  // Drag the left edge to resize (wider is handy for the one-page summary's tables).
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    const move = (ev: PointerEvent) => {
      const w = Math.min(Math.max(300, w0 + (x0 - ev.clientX)), Math.min(900, window.innerWidth * 0.7));
      set({ panelWidth: Math.round(w) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        localStorage.setItem("ps-panel-width", String(useReader.getState().panelWidth));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      className={cx("relative flex shrink-0 flex-col bg-bg", bottom ? "h-[42vh] w-full border-t border-line" : "h-full max-w-[92vw] border-l border-line")}
      style={bottom ? undefined : { width }}
    >
      {!bottom && (
        <div
          title="拖曳調整寬度"
          onPointerDown={startResize}
          className="absolute -left-1 top-0 z-10 hidden h-full w-2 cursor-col-resize hover:bg-accent/30 md:block"
        />
      )}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="font-semibold">{label}</div>
        <IconButton title="關閉" onClick={() => set({ rightTab: null })}>
          <X size={17} />
        </IconButton>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <ErrorBoundary label={label} compact resetKey={tab}>
          {tab === "onepager" && <OnePagerPanel />}
          {tab === "ai" && <AIPanel />}
          {tab === "quiz" && <QuizPanel />}
          {tab === "highlights" && <HighlightsPanel mode="highlights" />}
          {tab === "comments" && <HighlightsPanel mode="comments" />}
          {tab === "explanations" && <ExplanationsPanel />}
          {tab === "notes" && <NotesPanel />}
          {tab === "citations" && <CitationsPanel />}
        </ErrorBoundary>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ AI ----

function AIPanel() {
  const [sub, setSub] = useState<"summary" | "keywords" | "chat">("summary");
  const draft = useReader((s) => s.chatDraft);
  useEffect(() => {
    if (draft) setSub("chat");
  }, [draft]);
  return (
    <div className="flex h-full flex-col">
      <div className="px-4 pt-3">
        <Segmented
          className="w-full"
          value={sub}
          onChange={setSub}
          options={[
            { value: "summary", label: "摘要" },
            { value: "keywords", label: "關鍵詞詞典" },
            { value: "chat", label: "討論" },
          ]}
        />
      </div>
      {sub === "summary" && <SummaryView />}
      {sub === "keywords" && <KeywordsView />}
      {sub === "chat" && <ChatView />}
    </div>
  );
}

function SummaryView() {
  const data = useReaderData();
  const rec = useLiveQuery(() => db.overviews.get(data.paperId), [data.paperId]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const saved = rec?.detail;
  const o = data.overview;
  const run = async () => {
    setBusy(true);
    setDetail("");
    try {
      const full = await aiStream(
        {
          task: "summary",
          targetLanguage: data.settings.targetLanguage,
          paperTitle: data.paper.title,
          paperText: fullText(data.model, 120000),
          overview: overviewText(o),
          researchContext: data.settings.researchContext,
          model: models(data.settings).chat,
        },
        setDetail,
      );
      if (rec) await db.overviews.put({ ...rec, detail: full });
    } catch (e) {
      toast(`摘要失敗：${friendlyError(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  if (!o) return <div className="p-4 text-sm text-ink-faint">翻譯開始前會先產生導讀，請稍候…</div>;
  return (
    <div className="space-y-4 p-4 text-sm">
      {o.titleZh && <div className="font-semibold">{o.titleZh}</div>}
      <div>
        <div className="mb-1.5 text-xs font-medium text-ink-faint">三句話摘要</div>
        <ol className="list-decimal space-y-1.5 pl-5">
          {o.summary3.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-xs font-medium text-ink-faint">詳細摘要</div>
          <Button className="!py-1 text-xs" disabled={busy} onClick={run}>
            {busy && <Loader2 size={12} className="animate-spin" />}
            {saved || detail ? "重新產生" : "產生詳細摘要"}
          </Button>
        </div>
        {(detail || saved) && <Markdown>{detail || saved || ""}</Markdown>}
      </div>
    </div>
  );
}

function KeywordsView() {
  const data = useReaderData();
  const kws = data.overview?.keywords ?? [];
  const find = (en: string) => {
    const re = new RegExp(en.split(/,\s*|\s*\(/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const sid = data.model.order.find((id) => re.test(data.model.sentences[id].text));
    if (sid) scrollToSentence(data.model, sid);
    else toast("原文中找不到這個詞");
  };
  if (!kws.length) return <div className="p-4 text-sm text-ink-faint">尚未產生關鍵詞</div>;
  return (
    <div className="divide-y divide-line">
      {kws.map((k) => (
        <button key={k.en} type="button" onClick={() => find(k.en)} className="block w-full px-4 py-3 text-left hover:bg-soft">
          <div className="text-sm font-medium">
            {k.en} <span className="text-accent-strong">{k.zh}</span>
          </div>
          <div className="mt-0.5 text-xs text-ink-soft">{k.def}</div>
        </button>
      ))}
    </div>
  );
}

function ChatView() {
  const data = useReaderData();
  const draft = useReader((s) => s.chatDraft);
  const set = useReader((s) => s.set);
  const msgs = useLiveQuery(() => db.chats.where("paperId").equals(data.paperId).filter((m) => !m.deleted).sortBy("createdAt"), [data.paperId]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (draft) {
      setInput(draft);
      set({ chatDraft: null });
    }
  }, [draft, set]);
  useEffect(() => endRef.current?.scrollIntoView({ block: "end" }), [msgs?.length, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming !== null) return;
    setInput("");
    const now = Date.now();
    await db.chats.put({ id: uid(), paperId: data.paperId, role: "user", text, createdAt: now, updatedAt: now });
    const history = [...(msgs ?? []), { role: "user" as const, text }].slice(-16).map((m) => ({ role: m.role, text: m.text }));
    setStreaming("");
    try {
      const full = await aiStream(
        {
          task: "chat",
          targetLanguage: data.settings.targetLanguage,
          paperTitle: data.paper.title,
          paperText: paperLines(data.model, 150_000),
          overview: overviewText(data.overview),
          researchContext: data.settings.researchContext,
          messages: history,
          model: models(data.settings).chat,
        },
        setStreaming,
      );
      const t = Date.now();
      await db.chats.put({ id: uid(), paperId: data.paperId, role: "model", text: full, createdAt: t, updatedAt: t });
    } catch (e) {
      toast(`討論失敗：${friendlyError(e)}`, "error");
    } finally {
      setStreaming(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto p-4">
        {!msgs?.length && streaming === null && (
          <div className="space-y-2 text-sm text-ink-soft">
            <p>什麼都可以問：這篇論文的內容、研究方法、寫作，或一般問題。出自論文的地方會附頁碼，點了跳到原句。例如：</p>
            {["這篇的研究限制是什麼？", "這篇的構念可以怎麼借用到服務品牌的主動行為？", "作者怎麼測量主要變數？"].map((q) => (
              <button key={q} type="button" onClick={() => setInput(q)} className="block rounded-lg border border-line px-3 py-1.5 text-left hover:bg-muted">
                {q}
              </button>
            ))}
          </div>
        )}
        {(msgs ?? []).map((m) => (
          <div key={m.id} className={cx("rounded-2xl px-3.5 py-2.5 text-sm", m.role === "user" ? "ml-8 bg-accent-soft" : "mr-2 bg-muted")}>
            {m.role === "user" ? <div className="whitespace-pre-wrap">{m.text}</div> : <CitedMarkdown md={String(m.text ?? "")} />}
          </div>
        ))}
        {streaming !== null && <div className="mr-2 rounded-2xl bg-muted px-3.5 py-2.5 text-sm">{streaming ? <CitedMarkdown md={streaming} /> : <Loader2 size={16} className="animate-spin" />}</div>}
        <div ref={endRef} />
      </div>
      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-xl border border-line px-3 py-2 focus-within:border-accent">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="問任何問題…（Enter 送出，Shift+Enter 換行）"
            className="max-h-40 flex-1 resize-none bg-transparent text-sm outline-none"
          />
          <IconButton title="送出" onClick={send} disabled={!input.trim() || streaming !== null}>
            <Send size={17} />
          </IconButton>
        </div>
        {!!msgs?.length && (
          <button
            type="button"
            className="mt-1 text-xs text-ink-faint hover:text-ink"
            onClick={async () => {
              if (confirm("清除這篇的討論紀錄？")) for (const m of msgs) await db.chats.update(m.id, { deleted: true, updatedAt: Date.now() });
            }}
          >
            清除討論
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- quiz ----

function QuizPanel() {
  const data = useReaderData();
  const rec = useLiveQuery(() => db.quizzes.get(data.paperId), [data.paperId]);
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    setBusy(true);
    try {
      const r = await aiJson<{ questions: QuizQuestion[] }>({
        task: "quiz",
        title: data.paper.title,
        text: fullText(data.model, 60000),
        targetLanguage: data.settings.targetLanguage,
        model: models(data.settings).chat,
      });
      await db.quizzes.put({ paperId: data.paperId, questions: r.questions, answers: r.questions.map(() => null), at: Date.now() });
    } catch (e) {
      toast(`出題失敗：${friendlyError(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  const answered = rec?.answers.filter((a) => a !== null).length ?? 0;
  const score = rec ? rec.questions.filter((q, i) => rec.answers[i] === q.answer).length : 0;
  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="flex items-center justify-between">
        <div className="text-ink-soft">{rec ? `已作答 ${answered}/${rec.questions.length}，答對 ${score} 題` : "用 5 題選擇題檢查自己是否讀懂。"}</div>
        <Button className="!py-1 text-xs" disabled={busy} onClick={gen}>
          {busy && <Loader2 size={12} className="animate-spin" />} {rec ? "重新出題" : "產生測驗"}
        </Button>
      </div>
      {rec?.questions.map((q, i) => {
        const a = rec.answers[i];
        return (
          <div key={i} className="rounded-xl border border-line p-3">
            <div className="font-medium">
              {i + 1}. {q.q}
            </div>
            <div className="mt-0.5 text-xs text-ink-soft">{q.qEn}</div>
            <div className="mt-2 space-y-1.5">
              {q.options.map((opt, j) => (
                <button
                  key={j}
                  type="button"
                  disabled={a !== null}
                  onClick={() => db.quizzes.update(data.paperId, { answers: rec.answers.map((x, k) => (k === i ? j : x)) })}
                  className={cx(
                    "block w-full rounded-lg border px-3 py-1.5 text-left",
                    a === null && "border-line hover:bg-muted",
                    a !== null && j === q.answer && "border-emerald-400 bg-emerald-50 dark:bg-emerald-950",
                    a !== null && j === a && j !== q.answer && "border-red-300 bg-red-50 dark:bg-red-950",
                    a !== null && j !== a && j !== q.answer && "border-line opacity-60",
                  )}
                >
                  {String.fromCharCode(65 + j)}. {opt}
                </button>
              ))}
            </div>
            {a !== null && (
              <div className="mt-2 rounded-lg bg-muted p-2 text-xs">
                <span className="font-semibold">{a === q.answer ? "答對了。" : "再想想。"}</span> {q.explain}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------- highlights ----

function HighlightsPanel({ mode }: { mode: "highlights" | "comments" }) {
  const data = useReaderData();
  const [color, setColor] = useState<string | null>(null);
  const list = useMemo(() => {
    let l = data.highlights;
    if (mode === "comments") l = l.filter((h) => h.note);
    else l = l.filter((h) => h.style === "highlight");
    if (color) l = l.filter((h) => h.color === color);
    return [...l].sort((a, b) => a.page - b.page || data.model.order.indexOf(a.ranges[0].sid) - data.model.order.indexOf(b.ranges[0].sid));
  }, [data.highlights, data.model, mode, color]);
  return (
    <div>
      {mode === "highlights" && (
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-2">
          <button type="button" onClick={() => setColor(null)} className={cx("rounded-md px-2 py-0.5 text-xs", !color ? "bg-muted font-medium" : "text-ink-soft")}>
            全部
          </button>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.label}
              onClick={() => setColor(color === c.key ? null : c.key)}
              className={cx("h-4 w-4 rounded-full ring-1 ring-black/10", color === c.key && "ring-2 ring-ink")}
              style={{ background: c.color }}
            />
          ))}
        </div>
      )}
      {!list.length && (
        <div className="p-4 text-sm text-ink-faint">
          {mode === "comments" ? "選取文字後按評論，或在劃線上寫下想法。" : "在原文或譯文選取文字即可劃線，兩側會同步顯示。"}
        </div>
      )}
      <div className="divide-y divide-line">
        {list.map((h) => (
          <HighlightItem key={h.id} h={h} />
        ))}
      </div>
    </div>
  );
}

function HighlightItem({ h }: { h: Highlight }) {
  const data = useReaderData();
  const [note, setNote] = useState(h.note);
  const page = printedPage(data.paper, data.model, h.page);
  const other =
    h.side === "src"
      ? h.ranges.map((r) => data.trans.get(r.sid)?.t ?? "").join("")
      : h.ranges.map((r) => data.model.sentences[r.sid]?.text ?? "").join(" ");
  return (
    <div className="group px-4 py-3">
      <button type="button" className="block w-full text-left" onClick={() => scrollToSentence(data.model, h.ranges[0].sid, h.ranges[0].start)}>
        <div className="flex gap-2">
          <span className="mt-1 w-1 shrink-0 self-stretch rounded-full" style={{ background: hlColor(h.color) }} />
          <div className="min-w-0 text-sm">
            <div>{h.text}</div>
            {other && <div className="mt-1 text-xs text-ink-soft">{other}</div>}
          </div>
        </div>
      </button>
      <div className="mt-1.5 flex items-center gap-2 pl-3 text-xs text-ink-faint">
        <Badge>{h.side === "src" ? "原文劃線" : "譯文劃線"}</Badge>
        <span>p. {page ?? h.page + 1}</span>
        <span>{relTime(h.createdAt)}</span>
        <div className="ml-auto flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" className="hover:text-ink" onClick={() => copyText(quoteWithCitation(h.text, data.paper, page), "已複製引用")}>
            複製引用
          </button>
          <button type="button" title="刪除" className="hover:text-red-600" onClick={() => softDelete("highlights", h.id)}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== h.note && db.highlights.update(h.id, { note, updatedAt: Date.now() })}
        placeholder="評論…"
        rows={note ? 2 : 1}
        className="mt-1.5 w-full resize-none rounded-lg border border-transparent bg-transparent px-2 py-1 text-xs outline-none hover:border-line focus:border-accent"
      />
    </div>
  );
}

// -------------------------------------------------------- explanations ----

function ExplanationsPanel() {
  const data = useReaderData();
  const [open, setOpen] = useState<string | null>(null);
  const list = [...data.explanations].sort((a, b) => b.createdAt - a.createdAt);
  if (!list.length) return <div className="p-4 text-sm text-ink-faint">選取文字按「解釋」，或用「圖片說明」框選圖表。</div>;
  return (
    <div className="divide-y divide-line">
      {list.map((e) => (
        <div key={e.id} className="group px-4 py-3 text-sm">
          <button
            type="button"
            className="block w-full text-left"
            onClick={() => {
              setOpen(open === e.id ? null : e.id);
              if (e.ranges?.length) scrollToSentence(data.model, e.ranges[0].sid, e.ranges[0].start);
              else useReader.getState().scrollToPage?.(e.page, e.rect?.[1]);
            }}
          >
            <div className="flex items-start gap-2">
              <Badge tone="violet">{e.kind === "text" ? "解釋" : e.kind === "model" ? "模型分析" : "圖表"}</Badge>
              <div className="line-clamp-2 flex-1 font-medium">{e.query}</div>
            </div>
            {e.thumb && <img src={e.thumb} alt="" className="mt-2 max-h-32 rounded-md border border-line" />}
          </button>
          {open === e.id ? (
            <div className="mt-2">
              <Markdown>{e.answer}</Markdown>
            </div>
          ) : (
            <div className="mt-1 line-clamp-2 text-xs text-ink-soft">{e.answer.replace(/[#*|`>-]/g, " ")}</div>
          )}
          <div className="mt-1 flex justify-end gap-3 text-xs text-ink-faint opacity-0 group-hover:opacity-100">
            <button type="button" className="hover:text-ink" onClick={() => copyText(e.answer)}>
              複製
            </button>
            <button type="button" title="刪除" className="hover:text-red-600" onClick={() => softDelete("explanations", e.id)}>
              刪除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------- notes ----

function NotesPanel() {
  const data = useReaderData();
  const rec = useLiveQuery(() => db.notes.get(data.paperId), [data.paperId]);
  const [text, setText] = useState<string | null>(null);
  const value = text ?? rec?.text ?? "";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChange = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => db.notes.put({ paperId: data.paperId, text: v, updatedAt: Date.now() }), 500);
  };
  return (
    <div className="flex h-full flex-col p-4">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="這篇論文的筆記（支援 Markdown，自動儲存）"
        className="min-h-[50vh] flex-1 resize-none rounded-xl border border-line bg-bg p-3 text-sm leading-relaxed outline-none focus:border-accent"
      />
      <div className="mt-2 text-right text-xs text-ink-faint">{rec ? `已儲存 ${relTime(rec.updatedAt)}` : ""}</div>
    </div>
  );
}

// ----------------------------------------------------------- citations ----

function CitationsPanel() {
  const data = useReaderData();
  const rec = useLiveQuery(() => db.refs.get(data.paperId), [data.paperId]);
  const [sub, setSub] = useState<"references" | "citedBy">("references");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const r = await postJson<{ references: WorkMeta[]; citedBy: WorkMeta[]; note?: string; error?: string }>("/api/scholar/refs", {
        openalexId: data.paper.openalexId,
        doi: data.paper.doi,
      });
      await db.refs.put({ paperId: data.paperId, references: r.references, citedBy: r.citedBy, at: Date.now(), note: r.note ?? r.error });
    } catch (e) {
      toast(`載入失敗：${friendlyError(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (rec === undefined && (data.paper.openalexId || data.paper.doi) && !busy) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec]);
  const list = rec?.[sub] ?? [];
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Segmented
          className="flex-1"
          value={sub}
          onChange={setSub}
          options={[
            { value: "references", label: `參考文獻 ${rec?.references.length ?? ""}` },
            { value: "citedBy", label: "被誰引用" },
          ]}
        />
        <Button className="!px-2 !py-1 text-xs" disabled={busy} onClick={load}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : "更新"}
        </Button>
      </div>
      {!data.paper.openalexId && !data.paper.doi && <div className="text-sm text-ink-faint">這篇還沒有對應到 DOI，無法載入引用。可在論文資訊確認書目。</div>}
      {rec?.note && <div className="mb-2 rounded-lg bg-muted p-2 text-xs text-ink-soft">{rec.note}</div>}
      <div className="space-y-2">
        {list.map((w) => (
          <WorkCard key={w.openalexId ?? w.doi ?? w.title} w={w} compact />
        ))}
      </div>
    </div>
  );
}
