"use client";
import { Copy, Search, Sparkles, Star, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { lineLabel, lineOf } from "@/engine/lines";
import { printedPage, quoteWithCitation } from "@/lib/citation";
import { type Highlight, db } from "@/lib/db";
import { HIGHLIGHT_COLORS } from "@/lib/defaults";
import { Segmented, copyText, cx, relTime } from "../ui";
import { quickHighlight, softDelete } from "./actions";
import { hlColor, scrollToSentences, useReaderData } from "./ReaderData";

type Lang = "zh" | "en" | "both";

interface Item {
  key: string;
  kind: "mine" | "auto";
  sids: string[];
  order: number;
  c?: string; // category
  h?: Highlight;
  en: string;
  zh: string;
}

function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>("both");
  useEffect(() => {
    try {
      const v = localStorage.getItem("ps-hl-lang");
      if (v === "zh" || v === "en" || v === "both") setLang(v);
    } catch {
      /* ignore */
    }
  }, []);
  return [
    lang,
    (l) => {
      setLang(l);
      try {
        localStorage.setItem("ps-hl-lang", l);
      } catch {
        /* ignore */
      }
    },
  ];
}

/**
 * One list for the AI's auto highlights and your own, in reading order.
 * Filter by source, category or colour; show Chinese, English or both.
 */
export function HighlightsPanel() {
  const data = useReaderData();
  const [lang, setLang] = useLang();
  const [showMine, setShowMine] = useState(true);
  const [showAuto, setShowAuto] = useState(true);
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [color, setColor] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const pos = useMemo(() => new Map(data.model.order.map((s, i) => [s, i])), [data.model]);

  const items = useMemo(() => {
    const out: Item[] = [];
    const mineSids = new Set<string>();
    for (const h of data.highlights) {
      if (h.style !== "highlight") continue;
      const sids = [...new Set(h.ranges.map((r) => r.sid))];
      sids.forEach((s) => mineSids.add(s));
      const en = h.side === "src" ? h.text : sids.map((s) => data.model.sentences[s]?.text ?? "").join(" ");
      const zh = h.side === "tgt" ? h.text : sids.map((s) => data.trans.get(s)?.t ?? "").join("");
      out.push({ key: h.id, kind: "mine", sids, order: pos.get(sids[0]) ?? 0, c: h.c, h, en, zh });
    }
    for (const [sid, c] of data.cats) {
      out.push({ key: `auto-${sid}`, kind: "auto", sids: [sid], order: pos.get(sid) ?? 0, c, en: data.model.sentences[sid]?.text ?? "", zh: data.trans.get(sid)?.t ?? "" });
    }
    return out.sort((a, b) => a.order - b.order || (a.kind === "mine" ? -1 : 1));
  }, [data.highlights, data.cats, data.model, data.trans, pos]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) if (it.c) m.set(it.c, (m.get(it.c) ?? 0) + 1);
    return m;
  }, [items]);
  const mineCount = items.filter((i) => i.kind === "mine").length;
  const autoCount = items.length - mineCount;

  const list = items.filter((it) => {
    if (it.kind === "mine" ? !showMine : !showAuto) return false;
    if (cats.size && !(it.c && cats.has(it.c))) return false;
    if (color && (it.kind !== "mine" || it.h?.color !== color)) return false;
    const k = q.trim().toLowerCase();
    if (k && !`${it.en} ${it.zh} ${it.h?.note ?? ""}`.toLowerCase().includes(k)) return false;
    return true;
  });

  const toggleCat = (k: string) =>
    setCats((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div>
      <div className="sticky top-0 z-10 space-y-2 border-b border-line bg-bg px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <Segmented
            value={lang}
            onChange={setLang}
            options={[
              { value: "zh", label: "中文" },
              { value: "en", label: "英文" },
              { value: "both", label: "中英" },
            ]}
          />
          <span className="text-xs text-ink-faint">{list.length} 則</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Chip on={showMine} onClick={() => setShowMine((v) => !v)}>
            我的劃線 {mineCount}
          </Chip>
          <Chip on={showAuto} onClick={() => setShowAuto((v) => !v)}>
            <Sparkles size={11} /> 自動高亮 {autoCount}
          </Chip>
          <span className="mx-0.5 h-4 w-px bg-line" />
          {data.settings.categories.map((c) => (
            <Chip key={c.key} on={cats.has(c.key)} color={c.color} onClick={() => toggleCat(c.key)}>
              {c.label} {counts.get(c.key) ?? 0}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              title={`只看我畫的${c.label}色`}
              onClick={() => setColor(color === c.key ? null : c.key)}
              className={cx("h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10", color === c.key && "ring-2 ring-ink")}
              style={{ background: c.color }}
            />
          ))}
          <label className="ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-line px-2 py-1">
            <Search size={13} className="shrink-0 text-ink-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
          </label>
        </div>
      </div>
      {!list.length && (
        <div className="p-4 text-sm text-ink-faint">
          {items.length ? "沒有符合篩選的高亮。" : "還沒有高亮。點兩下句子可以直接整句劃線，也可以選取文字後選顏色；AI 的自動高亮會在翻譯時出現在這裡。"}
        </div>
      )}
      <div className="divide-y divide-line">
        {list.map((it) => (
          <Row key={it.key} it={it} lang={lang} />
        ))}
      </div>
    </div>
  );
}

function Chip({ on, color, onClick, children }: { on: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5", on ? "border-transparent bg-ink text-bg" : "border-line text-ink-soft hover:bg-muted")}
      style={on && color ? { background: color, color: "#1f2328" } : undefined}
    >
      {color && !on && <span className="h-2 w-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}

function Row({ it, lang }: { it: Item; lang: Lang }) {
  const data = useReaderData();
  const cat = data.settings.categories.find((c) => c.key === it.c);
  const loc = lineOf(data.model, it.sids[0]);
  const pageNo = loc ? (printedPage(data.paper, data.model, loc.page) ?? String(loc.page + 1)) : "";
  const where = loc ? `p.${pageNo} ${lineLabel(loc, true)}` : "";
  const bar = it.kind === "mine" ? hlColor(it.h!.color) : (cat?.color ?? "#94a3b8");
  const zh = it.zh || "（翻譯中）";
  const setCat = (c: string) => it.h && void db.highlights.update(it.h.id, { c: c || undefined, updatedAt: Date.now() });

  return (
    <div className="group px-4 py-3">
      <button type="button" className="block w-full text-left" onClick={() => scrollToSentences(data.model, it.sids, data.paper)}>
        <div className="flex gap-2">
          <span className="mt-0.5 w-1 shrink-0 self-stretch rounded-full" style={{ background: bar, opacity: it.kind === "auto" ? 0.7 : 1 }} />
          <div className="min-w-0 space-y-1 text-sm leading-relaxed">
            {lang !== "en" && <div className={lang === "both" ? "text-ink" : ""}>{zh}</div>}
            {lang !== "zh" && <div className={lang === "both" ? "text-[13px] text-ink-soft" : ""}>{it.en}</div>}
          </div>
        </div>
      </button>
      {it.h?.note && <div className="mt-1.5 ml-3 rounded-lg bg-muted px-2.5 py-1.5 text-xs">{it.h.note}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-3 text-xs text-ink-faint">
        {it.kind === "auto" ? (
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5" style={{ background: `${cat?.color ?? "#94a3b8"}33`, color: "#374151" }}>
            <Sparkles size={10} /> {cat?.label ?? "自動高亮"}
          </span>
        ) : (
          <select
            value={it.c ?? ""}
            onChange={(e) => setCat(e.target.value)}
            title="分類"
            className="rounded-md border border-line bg-bg px-1 py-0.5 text-xs text-ink-soft"
            style={cat ? { background: `${cat.color}33`, color: "#374151" } : undefined}
          >
            <option value="">未分類</option>
            {data.settings.categories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        <span>{where}</span>
        {it.h && <span>{it.h.side === "src" ? "原文劃線" : "譯文劃線"}</span>}
        {it.h && <span>{relTime(it.h.createdAt)}</span>}
        <div className="ml-auto flex items-center gap-2 opacity-60 transition-opacity group-hover:opacity-100">
          {it.kind === "auto" && (
            <button
              type="button"
              title="收進我的劃線（之後可以改顏色與分類）"
              className="inline-flex items-center gap-0.5 hover:text-ink"
              onClick={async () => {
                const id = await quickHighlight(data.paperId, data.model, it.sids[0], "src", undefined, data.settings.quickColor || "green");
                if (id && it.c) await db.highlights.update(id, { c: it.c });
              }}
            >
              <Star size={12} /> 收藏
            </button>
          )}
          <button type="button" title="複製引用（APA）" className="hover:text-ink" onClick={() => copyText(quoteWithCitation(lang === "zh" ? zh : it.en, data.paper, pageNo), "已複製引用")}>
            <Copy size={12} />
          </button>
          {it.h && (
            <button type="button" title="刪除" className="hover:text-red-600" onClick={() => softDelete("highlights", it.h!.id)}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
