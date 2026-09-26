"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy, Download, Loader2, RefreshCw, ScrollText, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { friendlyError } from "@/lib/api";
import { download, printedPage, safeFileName } from "@/lib/citation";
import { db } from "@/lib/db";
import { generateOnePager } from "@/lib/pipeline";
import { models } from "@/lib/settings";
import { useReader } from "@/store/reader";
import { Button, copyText } from "../ui";
import { scrollToSentence, useReaderData } from "./ReaderData";

/**
 * 一頁速覽: a one-page breakdown of the paper (Keshav's first pass + a
 * management-research template). Every claim cites a sentence id, rendered
 * as a chip that jumps to the source sentence.
 */
export function OnePagerModal() {
  const data = useReaderData();
  const open = useReader((s) => s.onepagerOpen);
  const set = useReader((s) => s.set);
  const rec = useLiveQuery(() => db.onepagers.get(data.paperId), [data.paperId]);
  const [live, setLive] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const started = useRef(false);

  const run = async (spec?: string) => {
    setErr("");
    setLive("");
    try {
      await generateOnePager(data.paperId, setLive, spec);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setLive(null);
    }
  };

  useEffect(() => {
    if (open && rec === undefined && !started.current && live === null) {
      started.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rec]);

  if (!open) return null;
  const md = live ?? rec?.md ?? "";
  const pageOf = (sid: string) => {
    const s = data.model.sentences[sid];
    if (!s) return null;
    return printedPage(data.paper, data.model, s.p) ?? String(s.p + 1);
  };
  const withChips = md.replace(/\[\[\s*(\d+\.\d+)\s*\]\]/g, (_, sid: string) => (data.model.sentences[sid] ? ` [p.${pageOf(sid)}](#sid-${sid})` : ""));

  return (
    <div className="fixed inset-0 z-[90] flex justify-center bg-black/30 p-3 sm:p-6" onMouseDown={() => set({ onepagerOpen: false })}>
      <div className="flex max-h-full w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-[var(--shadow)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <ScrollText size={18} className="text-accent-strong" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">一頁速覽</div>
            <div className="truncate text-xs text-ink-faint">{data.paper.title}</div>
          </div>
          {live !== null && <Loader2 size={16} className="animate-spin text-ink-faint" />}
          <Button className="!px-2 !py-1 text-xs" disabled={live !== null} onClick={() => run(models(data.settings).chat)} title="用解釋模型重新產生">
            <RefreshCw size={13} /> 重新產生
          </Button>
          <Button className="!px-2 !py-1 text-xs" disabled={!md} onClick={() => copyText(md.replace(/\[\[\s*(\d+\.\d+)\s*\]\]/g, (_, s: string) => `(p. ${pageOf(s)})`))}>
            <Copy size={13} />
          </Button>
          <Button
            className="!px-2 !py-1 text-xs"
            disabled={!md}
            onClick={() => download(`${safeFileName(data.paper.title)}-一頁速覽.md`, md.replace(/\[\[\s*(\d+\.\d+)\s*\]\]/g, (_, s: string) => `(p. ${pageOf(s)})`), "text/markdown")}
          >
            <Download size={13} />
          </Button>
          <button type="button" title="關閉" onClick={() => set({ onepagerOpen: false })} className="ml-1 text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="scroll-thin overflow-y-auto px-6 py-5">
          {err && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</div>}
          {!md && !err && (
            <div className="space-y-2">
              <div className="text-sm text-ink-soft">正在閱讀全文並整理成一頁…</div>
              <div className="ps-shimmer h-40 rounded-xl" />
            </div>
          )}
          <div className="ps-md ps-onepager">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => {
                  if (href?.startsWith("#sid-")) {
                    const sid = href.slice(5);
                    return (
                      <button
                        type="button"
                        className="mx-0.5 inline-flex items-center rounded-md bg-accent-soft px-1.5 py-0 align-baseline text-[11px] font-medium text-accent-strong hover:underline"
                        onClick={() => {
                          set({ onepagerOpen: false });
                          setTimeout(() => scrollToSentence(data.model, sid), 50);
                        }}
                      >
                        {children}
                      </button>
                    );
                  }
                  return (
                    <a href={href} target="_blank" rel="noreferrer" className="text-accent-strong underline">
                      {children}
                    </a>
                  );
                },
              }}
            >
              {withChips}
            </ReactMarkdown>
          </div>
        </div>
        {rec?.model && live === null && <div className="border-t border-line px-5 py-2 text-right text-[11px] text-ink-faint">由 {rec.model} 產生・點頁碼可跳到原句</div>}
      </div>
    </div>
  );
}
