"use client";
import {
  ChevronDown,
  Download,
  Highlighter,
  Info,
  ListTree,
  Loader2,
  Minus,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  ScanSearch,
  Search,
  Settings,
} from "lucide-react";
import { useMemo, useState } from "react";
import { apaReference, download, inText, printedPage, safeFileName, toMarkdown, toRis } from "@/lib/citation";
import { db, resetTranslations } from "@/lib/db";
import { COLOR_SCHEMES } from "@/lib/defaults";
import { enqueue } from "@/lib/pipeline";
import { saveSettings } from "@/lib/settings";
import { useReader } from "@/store/reader";
import { useApp } from "../AppFrame";
import { Button, IconButton, Segmented, copyText, cx, toast } from "../ui";
import { scrollToSentence, useReaderData } from "./ReaderData";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function Toolbar() {
  const data = useReaderData();
  const r = useReader();
  const setApp = useApp((s) => s.set);
  const [autoOpen, setAutoOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const pageCount = data.model.pages.length;
  const pct = Math.round(r.scale * 100);
  const job = data.job;
  const mockCount = useMemo(() => [...data.trans.values()].filter((t) => t.mock).length, [data.trans]);

  const close = () => {
    setAutoOpen(false);
    setZoomOpen(false);
    setExportOpen(false);
  };
  const toggle = (k: "outlineOpen" | "infoOpen" | "searchOpen") =>
    r.set({ outlineOpen: false, infoOpen: false, searchOpen: false, [k]: !r[k] });

  return (
    <div className="relative z-30 flex h-14 shrink-0 items-center gap-1 border-b border-line bg-bg px-2" onMouseLeave={close}>
      {!r.leftOpen && (
        <IconButton title="展開側欄" onClick={() => r.set({ leftOpen: true })}>
          <PanelLeftOpen size={18} />
        </IconButton>
      )}
      <IconButton title="目錄" active={r.outlineOpen} onClick={() => toggle("outlineOpen")}>
        <ListTree size={18} />
      </IconButton>
      <IconButton title="論文資訊" active={r.infoOpen} onClick={() => toggle("infoOpen")}>
        <Info size={18} />
      </IconButton>
      <IconButton title="搜尋" active={r.searchOpen} onClick={() => toggle("searchOpen")}>
        <Search size={18} />
      </IconButton>

      <div className="relative ml-1 hidden sm:block">
        <button type="button" onClick={() => setZoomOpen((v) => !v)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-2.5 text-sm">
          {r.zoom === "fit" ? "符合寬度" : `${pct}%`} <ChevronDown size={14} />
        </button>
        {zoomOpen && (
          <div className="absolute left-0 top-10 w-32 overflow-hidden rounded-xl border border-line bg-bg py-1 text-sm shadow-[var(--shadow)]">
            <MenuBtn onClick={() => (r.set({ zoom: "fit" }), close())}>符合寬度</MenuBtn>
            {ZOOMS.map((z) => (
              <MenuBtn key={z} onClick={() => (r.set({ zoom: z }), close())}>
                {Math.round(z * 100)}%
              </MenuBtn>
            ))}
          </div>
        )}
      </div>
      <IconButton title="縮小" onClick={() => r.set({ zoom: Math.max(0.3, Math.round((r.scale / 1.15) * 100) / 100) })}>
        <Minus size={18} />
      </IconButton>
      <IconButton title="放大" onClick={() => r.set({ zoom: Math.min(4, Math.round(r.scale * 1.15 * 100) / 100) })}>
        <Plus size={18} />
      </IconButton>
      <div className="mx-1 hidden h-9 items-center rounded-lg border border-line px-2.5 text-sm tabular-nums md:inline-flex">
        <input
          className="w-8 bg-transparent text-right outline-none"
          value={r.currentPage + 1}
          onChange={() => {}}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const n = Number((e.target as HTMLInputElement).value);
            if (n >= 1 && n <= pageCount) r.scrollToPage?.(n - 1);
          }}
          onFocus={(e) => e.target.select()}
        />
        <span className="text-ink-faint">&nbsp;/ {pageCount}</span>
      </div>

      <span className="mx-1 h-6 w-px bg-line" />

      <div className="relative">
        <button
          type="button"
          onClick={() => setAutoOpen((v) => !v)}
          className={cx("inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm", r.showAuto ? "bg-accent-soft text-accent-strong" : "hover:bg-muted")}
        >
          <Highlighter size={16} /> <span className="hidden lg:inline">自動高亮</span>
        </button>
        {autoOpen && <AutoHighlightMenu onClose={close} />}
      </div>
      <button
        type="button"
        onClick={() => r.set({ regionMode: !r.regionMode, figure: null })}
        className={cx("inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm", r.regionMode ? "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" : "hover:bg-muted")}
        title="框選圖表，讓 AI 解讀"
      >
        <ScanSearch size={16} /> <span className="hidden lg:inline">{r.regionMode ? "框選圖表中…" : "圖片說明"}</span>
      </button>
      <Segmented
        className="ml-1 hidden md:inline-flex"
        value={r.viewMode}
        onChange={(v) => r.set({ viewMode: v })}
        options={[
          { value: "both", label: "並排檢視" },
          { value: "tgt", label: "僅看譯文" },
          { value: "src", label: "僅看原文" },
        ]}
      />

      <div className="ml-auto flex items-center gap-1">
        {job && job.stage !== "done" && (
          <span
            title={job.error}
            className={cx(
              "hidden items-center gap-1 rounded-full px-2.5 py-1 text-xs sm:inline-flex",
              job.stage === "error" ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" : "bg-muted text-ink-soft",
            )}
          >
            {job.stage !== "error" && <Loader2 size={12} className="animate-spin" />}
            {job.stage === "translating"
              ? `翻譯中 ${job.pagesDone}/${job.pagesTotal}`
              : job.stage === "error"
                ? "部分頁面失敗"
                : job.stage === "overview"
                  ? "建立術語表"
                  : job.stage === "meta"
                    ? "查詢書目"
                    : job.stage === "related"
                      ? "尋找相關論文"
                      : "處理中"}
            {job.stage === "error" && (
              <button type="button" className="ml-1 underline" onClick={() => enqueue(data.paperId, true)}>
                重試
              </button>
            )}
          </span>
        )}
        {mockCount > 0 && (
          <span className="hidden rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800 xl:inline dark:bg-amber-950 dark:text-amber-300" title="伺服器沒有 Gemini key，目前是示範譯文">
            示範譯文
          </span>
        )}
        <IconButton title="設定" onClick={() => setApp({ settingsOpen: true })}>
          <Settings size={18} />
        </IconButton>
        <div className="relative">
          <IconButton title="匯出" onClick={() => setExportOpen((v) => !v)}>
            <Download size={18} />
          </IconButton>
          {exportOpen && <ExportMenu onClose={close} />}
        </div>
      </div>

      {r.outlineOpen && <OutlinePanel />}
      {r.infoOpen && <InfoPanel />}
      {r.searchOpen && <SearchPanel />}
    </div>
  );
}

function MenuBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="block w-full px-3 py-1.5 text-left hover:bg-muted">
      {children}
    </button>
  );
}

function AutoHighlightMenu({ onClose }: { onClose: () => void }) {
  const data = useReaderData();
  const showAuto = useReader((s) => s.showAuto);
  const set = useReader((s) => s.set);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of data.trans.values()) if (t.c) m.set(t.c, (m.get(t.c) ?? 0) + 1);
    return m;
  }, [data.trans]);
  return (
    <div className="absolute left-0 top-11 w-[340px] rounded-2xl border border-line bg-bg shadow-[var(--shadow)]">
      <div className="flex items-stretch border-b border-line">
        <div className="flex-1 px-4 py-3">
          <div className="font-semibold">自動高亮</div>
          <div className="text-xs text-ink-soft">AI 在翻譯時同步標出論文的關鍵句，兩側同時顯示</div>
        </div>
        <button type="button" onClick={() => set({ showAuto: !showAuto })} className="w-20 border-l border-line bg-muted text-sm font-medium hover:bg-line">
          {showAuto ? "隱藏" : "顯示"}
        </button>
      </div>
      <div className="px-4 py-3">
        <div className="mb-2 text-xs text-ink-faint">色彩方案</div>
        {COLOR_SCHEMES.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted">
            <input type="radio" checked={data.settings.colorScheme === c.key} onChange={() => saveSettings({ colorScheme: c.key })} />
            <span className="flex gap-1">
              {data.settings.categories.slice(0, 3).map((cat) => (
                <span
                  key={cat.key}
                  className="h-3 w-5 rounded-sm"
                  style={c.key === "stroke" ? { borderBottom: `2px solid ${cat.color}` } : { background: `${cat.color}${c.key === "deep" ? "66" : "33"}` }}
                />
              ))}
            </span>
            <span className="text-sm">{c.label}</span>
            <span className="ml-auto text-xs text-ink-faint">{c.hint}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-4 py-2.5 text-xs">
        {data.settings.categories.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} /> {c.label}
            <span className="text-ink-faint">{counts.get(c.key) ?? 0}</span>
          </span>
        ))}
      </div>
      <div className="border-t border-line px-4 py-2 text-right">
        <button type="button" className="text-xs text-ink-soft hover:underline" onClick={onClose}>
          關閉
        </button>
      </div>
    </div>
  );
}

function Floating({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("scroll-thin absolute left-2 top-14 max-h-[70vh] w-[380px] max-w-[calc(100vw-16px)] overflow-y-auto rounded-2xl border border-line bg-bg p-3 shadow-[var(--shadow)]", className)}>
      {children}
    </div>
  );
}

function OutlinePanel() {
  const data = useReaderData();
  const heads = data.model.order.filter((sid) => data.model.sentences[sid].kind === "heading");
  return (
    <Floating>
      <div className="mb-2 px-1 text-sm font-semibold">目錄</div>
      {!heads.length && <div className="px-1 text-sm text-ink-faint">沒有偵測到標題</div>}
      {heads.map((sid) => {
        const s = data.model.sentences[sid];
        const zh = data.trans.get(sid)?.t;
        return (
          <button key={sid} type="button" onClick={() => scrollToSentence(data.model, sid)} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
            <span className="text-ink">{zh || s.text}</span>
            {zh && <span className="ml-2 text-xs text-ink-faint">{s.text}</span>}
            <span className="float-right text-xs text-ink-faint">{s.p + 1}</span>
          </button>
        );
      })}
    </Floating>
  );
}

function SearchPanel() {
  const data = useReaderData();
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (k.length < 2) return [];
    const out: { sid: string; text: string; zh?: string }[] = [];
    for (const sid of data.model.order) {
      const s = data.model.sentences[sid];
      const zh = data.trans.get(sid)?.t;
      if (s.text.toLowerCase().includes(k) || zh?.toLowerCase().includes(k)) out.push({ sid, text: s.text, zh });
      if (out.length >= 60) break;
    }
    return out;
  }, [q, data.model, data.trans]);
  return (
    <Floating>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋原文或譯文" className="mb-2 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent" />
      {results.map((r) => (
        <button key={r.sid} type="button" onClick={() => scrollToSentence(data.model, r.sid)} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
          <div className="line-clamp-2">{r.text}</div>
          {r.zh && <div className="line-clamp-1 text-xs text-ink-soft">{r.zh}</div>}
        </button>
      ))}
      {q.trim().length >= 2 && !results.length && <div className="px-1 text-sm text-ink-faint">找不到</div>}
    </Floating>
  );
}

function InfoPanel() {
  const data = useReaderData();
  const p = data.paper;
  const [offset, setOffset] = useState<string>(String(p.pageOffset ?? data.model.info.pageOffset ?? ""));
  const detected = data.model.info.pageOffset;
  return (
    <Floating className="w-[440px]">
      <div className="space-y-3 text-sm">
        <div>
          <div className="font-semibold leading-snug">{p.title}</div>
          {p.titleZh && <div className="text-ink-soft">{p.titleZh}</div>}
          <div className="mt-1 text-xs text-ink-soft">
            {p.authors.map((a) => a.display).join(", ")}
            {p.year ? ` · ${p.year}` : ""}
            {p.journal ? ` · ${p.journal}` : ""}
          </div>
          {p.doi && (
            <a className="text-xs text-accent-strong hover:underline" href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer">
              doi:{p.doi}
            </a>
          )}
        </div>
        <div className="rounded-lg bg-muted p-2.5 text-xs">
          <div className="mb-1 font-medium">APA 參考文獻</div>
          <div className="text-ink-soft">{apaReference(p).replace(/\*/g, "")}</div>
          <div className="mt-2 flex gap-2">
            <Button className="!px-2 !py-1 text-xs" onClick={() => copyText(apaReference(p).replace(/\*/g, ""))}>
              複製
            </Button>
            <Button className="!px-2 !py-1 text-xs" onClick={() => copyText(inText(p, printedPage(p, data.model, useReader.getState().currentPage)))}>
              複製文中引用（本頁）
            </Button>
          </div>
        </div>
        <div>
          <div className="mb-1 font-medium">頁碼對應</div>
          <div className="flex items-center gap-2 text-xs text-ink-soft">
            印刷頁碼 = PDF 頁序 +
            <input className="w-16 rounded-md border border-line bg-bg px-2 py-1" value={offset} onChange={(e) => setOffset(e.target.value)} />
            <Button
              className="!px-2 !py-1 text-xs"
              onClick={async () => {
                const v = offset.trim() === "" ? null : Number(offset) - 0;
                await db.papers.update(p.id, { pageOffset: v === null || Number.isNaN(v) ? null : v, updatedAt: Date.now() });
                toast("已更新頁碼");
              }}
            >
              儲存
            </Button>
          </div>
          <div className="mt-1 text-xs text-ink-faint">
            自動偵測：{detected != null ? `PDF 第 1 頁 = p. ${detected + 1}` : "未偵測到"}；目前第 {data.model.pages.length ? useReader.getState().currentPage + 1 : 0} 頁 = p. {printedPage(p, data.model, useReader.getState().currentPage) ?? "?"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button className="text-xs" onClick={() => enqueue(p.id, true)}>
            <RefreshCw size={13} /> 繼續未完成的步驟
          </Button>
          <Button
            variant="danger"
            className="text-xs"
            onClick={async () => {
              if (!confirm("清除這篇的譯文與自動高亮並重新翻譯？你的劃線與筆記會保留。")) return;
              await resetTranslations(p.id);
              enqueue(p.id, true);
            }}
          >
            重新翻譯整篇
          </Button>
        </div>
        {data.job?.error && <div className="text-xs text-red-600">{data.job.error}</div>}
      </div>
    </Floating>
  );
}

function ExportMenu({ onClose }: { onClose: () => void }) {
  const data = useReaderData();
  const p = data.paper;
  const translations = new Map([...data.trans].map(([k, v]) => [k, v.t]));
  const notes = async () => (await db.notes.get(p.id))?.text ?? "";
  return (
    <div className="absolute right-0 top-10 w-60 overflow-hidden rounded-xl border border-line bg-bg py-1 text-sm shadow-[var(--shadow)]">
      <MenuBtn
        onClick={() => {
          download(`${safeFileName(p.title)}.ris`, toRis(p, { highlights: data.highlights, model: data.model, translations }), "application/x-research-info-systems");
          onClose();
        }}
      >
        匯出到 Zotero（RIS，含劃線筆記）
      </MenuBtn>
      <MenuBtn
        onClick={async () => {
          download(`${safeFileName(p.title)}.md`, toMarkdown(p, { highlights: data.highlights, explanations: data.explanations, model: data.model, translations, notes: await notes() }), "text/markdown");
          onClose();
        }}
      >
        匯出筆記（Markdown）
      </MenuBtn>
      <MenuBtn onClick={() => (copyText(apaReference(p).replace(/\*/g, "")), onClose())}>複製 APA 參考文獻</MenuBtn>
    </div>
  );
}
