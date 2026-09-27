"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy, Download, Loader2, Maximize2, PanelRight, RefreshCw, ScrollText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { lineLabel, lineOf } from "@/engine/lines";
import type { DocModel } from "@/engine/types";
import { friendlyError } from "@/lib/api";
import { download, printedPage, safeFileName } from "@/lib/citation";
import { type Paper, db } from "@/lib/db";
import { generateOnePager } from "@/lib/pipeline";
import { models } from "@/lib/settings";
import { useReader } from "@/store/reader";
import { Button, copyText, cx } from "../ui";
import { scrollToSentences, useReaderData } from "./ReaderData";

/**
 * 一頁速覽: a one-page breakdown of the paper (Keshav's first pass + a
 * management-research template). Claims cite sentence ids, e.g. [[3.12]] or
 * [[3.12, 4.2]]; they render as page chips that scroll to and flash those
 * sentences. Lives in the right sidebar so it can stay open while reading.
 */

// [[1.2]], [[1.2, 1.4]], [[1.2；2.3]] … and the occasional single-bracket [1.2, 1.4]
const CITE_DOUBLE = /\[\[\s*([^\]]*?\d+\.\d+[^\]]*?)\s*\]\]/g;
const CITE_SINGLE = /\[\s*(\d+\.\d+(?:\s*[,，;；、]\s*\d+\.\d+)*)\s*\](?!\()/g;
const SIDS = /\d+\.\d+/g;

function pageLabel(paper: Paper, model: DocModel, p: number) {
  return printedPage(paper, model, p) ?? String(p + 1);
}

/** Groups cited sentence ids by page, in citation order. */
function groups(model: DocModel, raw: string): { page: number; sids: string[] }[] {
  const out: { page: number; sids: string[] }[] = [];
  for (const sid of raw.match(SIDS) ?? []) {
    const s = model.sentences[sid];
    if (!s) continue;
    const g = out.find((x) => x.page === s.p);
    if (g) {
      if (!g.sids.includes(sid)) g.sids.push(sid);
    } else out.push({ page: s.p, sids: [sid] });
  }
  return out;
}

/** Markdown with citations turned into chip links: [p.71 左欄 12 行](#cite-1.2,1.4). */
export function citeLinks(md: string, paper: Paper, model: DocModel) {
  const rep = (_: string, inner: string) => {
    const gs = groups(model, inner);
    if (!gs.length) return "";
    return (
      " " +
      gs
        .map((g) => {
          const pos = lineOf(model, g.sids[0]);
          return `[p.${pageLabel(paper, model, g.page)}${pos ? ` ${lineLabel(pos, true)}` : ""}](#cite-${g.sids.join(",")})`;
        })
        .join(" ")
    );
  };
  return md.replace(CITE_DOUBLE, rep).replace(CITE_SINGLE, rep);
}

/** Plain-text citations for copy/download: (p. 70 左欄第 12 行; p. 72 右欄第 3 行). */
export function citePlain(md: string, paper: Paper, model: DocModel) {
  const rep = (_: string, inner: string) => {
    const gs = groups(model, inner);
    if (!gs.length) return "";
    return `(${gs
      .map((g) => {
        const pos = lineOf(model, g.sids[0]);
        return `p. ${pageLabel(paper, model, g.page)}${pos ? ` ${lineLabel(pos)}` : ""}`;
      })
      .join("; ")})`;
  };
  return md.replace(CITE_DOUBLE, rep).replace(CITE_SINGLE, rep);
}

const inflight = new Set<string>();

/** Markdown whose [[sid]] citations render as page chips that jump to the sentences. */
type Trail = { list: string[][]; index: number };
export function CitedMarkdown({ md, className, onCite }: { md: string; className?: string; onCite?: (sids: string[], trail: Trail) => void }) {
  const data = useReaderData();
  const linked = useMemo(() => citeLinks(md, data.paper, data.model), [md, data.paper, data.model]);
  // Every citation in order, so the focus tag can step to the previous / next one.
  const all = useMemo(() => [...linked.matchAll(/\(#cite-([^)]+)\)/g)].map((m) => m[1]), [linked]);
  // Hover preview: the cited sentence(s) in the original and in translation.
  const preview = (sids: string[]) =>
    sids
      .slice(0, 2)
      .map((sid) => {
        const en = data.model.sentences[sid]?.text ?? "";
        const zh = data.trans.get(sid)?.t;
        return `${en.length > 220 ? `${en.slice(0, 220)}…` : en}${zh ? `\n→ ${zh.length > 120 ? `${zh.slice(0, 120)}…` : zh}` : ""}`;
      })
      .join("\n\n") + (sids.length > 2 ? `\n\n…以及另外 ${sids.length - 2} 句` : "");
  return (
    <div className={cx("ps-md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#cite-")) {
              const sids = href.slice(6).split(",");
              return (
                <button
                  type="button"
                  title={preview(sids)}
                  className="ps-cite"
                  onClick={() => {
                    const trail = { list: all.map((a) => a.split(",")), index: Math.max(0, all.indexOf(sids.join(","))) };
                    if (onCite) onCite(sids, trail);
                    else scrollToSentences(data.model, sids, data.paper, trail);
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
        {linked}
      </ReactMarkdown>
    </div>
  );
}

function useOnePager() {
  const data = useReaderData();
  // "loading" until IndexedDB answers, then the record or null (so we never regenerate by mistake).
  const got = useLiveQuery(() => db.onepagers.get(data.paperId).then((r) => r ?? null), [data.paperId], "loading" as const);
  const loading = got === "loading";
  const rec = loading ? undefined : got;
  const [live, setLive] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const run = async (spec?: string) => {
    const id = data.paperId;
    inflight.add(id);
    setErr("");
    setLive("");
    try {
      await generateOnePager(id, setLive, spec);
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      inflight.delete(id);
      setLive(null);
    }
  };
  return { data, rec, loading, live, err, run, md: live ?? rec?.md ?? "" };
}

function OnePagerBody({ variant }: { variant: "panel" | "modal" }) {
  const { data, rec, loading, live, err, run, md } = useOnePager();
  const set = useReader((s) => s.set);
  const started = useRef(false);

  useEffect(() => {
    if (!loading && rec === null && !started.current && live === null && !inflight.has(data.paperId)) {
      started.current = true;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rec]);

  const plain = () => citePlain(md, data.paper, data.model);

  const actions = (
    <div className="flex items-center gap-1">
      {live !== null && <Loader2 size={15} className="mr-1 animate-spin text-ink-faint" />}
      <Button className="!px-2 !py-1 text-xs" disabled={live !== null} onClick={() => run(models(data.settings).chat)} title="用解釋模型重新產生">
        <RefreshCw size={13} /> 重新產生
      </Button>
      <Button className="!px-2 !py-1 text-xs" title="複製" disabled={!md} onClick={() => copyText(plain())}>
        <Copy size={13} />
      </Button>
      <Button className="!px-2 !py-1 text-xs" title="下載 Markdown" disabled={!md} onClick={() => download(`${safeFileName(data.paper.title)}-一頁速覽.md`, plain(), "text/markdown")}>
        <Download size={13} />
      </Button>
      {variant === "panel" ? (
        <Button className="!px-2 !py-1 text-xs" title="放大閱讀" onClick={() => set({ onepagerOpen: true })}>
          <Maximize2 size={13} />
        </Button>
      ) : (
        <Button className="!px-2 !py-1 text-xs" title="放回側欄，邊看速覽邊對照原文" onClick={() => set({ onepagerOpen: false, rightTab: "onepager" })}>
          <PanelRight size={13} /> 放到側欄
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cx("sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-bg", variant === "panel" ? "px-4 py-2" : "hidden")}>
        <span className="text-xs text-ink-faint">點頁碼跳到原句</span>
        {actions}
      </div>
      {variant === "modal" && <div className="flex justify-end border-b border-line px-5 py-2">{actions}</div>}
      <div className={cx("scroll-thin min-h-0 flex-1 overflow-y-auto", variant === "panel" ? "px-4 py-3" : "px-6 py-5")}>
        {err && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{err}</div>}
        {!md && !err && (
          <div className="space-y-2">
            <div className="text-sm text-ink-soft">正在閱讀全文並整理成一頁…</div>
            <div className="ps-shimmer h-40 rounded-xl" />
          </div>
        )}
        <CitedMarkdown
          md={md}
          className={cx("ps-onepager", variant === "panel" && "is-panel")}
          onCite={(sids, trail) => {
            // In the enlarged view, dock the summary to the sidebar so it stays visible.
            if (variant === "modal") set({ onepagerOpen: false, rightTab: "onepager" });
            setTimeout(() => scrollToSentences(data.model, sids, data.paper, trail), variant === "modal" ? 80 : 0);
          }}
        />
        {rec?.model && live === null && <div className="mt-4 text-right text-[11px] text-ink-faint">由 {rec.model} 產生</div>}
      </div>
    </div>
  );
}

/** Right-sidebar tab. */
export function OnePagerPanel() {
  return <OnePagerBody variant="panel" />;
}

/** Enlarged reading view. */
export function OnePagerModal() {
  const data = useReaderData();
  const open = useReader((s) => s.onepagerOpen);
  const set = useReader((s) => s.set);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex justify-center bg-black/30 p-3 sm:p-6" onMouseDown={() => set({ onepagerOpen: false })}>
      <div className="flex max-h-full w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-[var(--shadow)]" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <ScrollText size={18} className="text-accent-strong" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">一頁速覽</div>
            <div className="truncate text-xs text-ink-faint">{data.paper.title}</div>
          </div>
          <button type="button" title="關閉" onClick={() => set({ onepagerOpen: false })} className="ml-1 text-ink-faint hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <OnePagerBody variant="modal" />
      </div>
    </div>
  );
}
