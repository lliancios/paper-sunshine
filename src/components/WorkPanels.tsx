"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { Bookmark, BookmarkCheck, ExternalLink, FileDown, Loader2, RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RelatedItem, WorkMeta } from "@/lib/apiTypes";
import { db } from "@/lib/db";
import { TIER_LABEL, matchJournal } from "@/lib/defaults";
import { refreshRelated } from "@/lib/pipeline";
import { saveSettings, useSettings } from "@/lib/settings";
import { doiUrl, openWork, saveWork, unsaveWork, workKey } from "@/lib/works";
import { useReader } from "@/store/reader";
import { Badge, IconButton, Segmented, cx, toast } from "./ui";

export function WorkCard({ w, compact }: { w: WorkMeta | RelatedItem; compact?: boolean }) {
  const router = useRouter();
  const settings = useSettings();
  const key = workKey(w);
  const saved = useLiveQuery(() => db.saved.get(key), [key]);
  const inLib = useLiveQuery(() => (w.doi ? db.papers.where("doi").equals(w.doi).filter((p) => !p.deleted).first() : undefined), [w.doi]);
  const [busy, setBusy] = useState(false);
  const tier = "tier" in w && w.tier ? w.tier : matchJournal(settings.journals, w.journal, w.issn)?.tier;
  const isSaved = !!saved && !saved.deleted;
  const reason = "reason" in w ? w.reason : undefined;
  const authors = w.authors.slice(0, 3).map((a) => a.family).join(", ") + (w.authors.length > 3 ? " et al." : "");

  const open = async () => {
    setBusy(true);
    try {
      const r = await openWork(w);
      if (r.paperId) router.push(`/read/${r.paperId}`);
      else toast("沒有免費全文，已加入「已儲存」。用 VPN 下載後拖進文獻庫，會依 DOI 自動配對。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx("group rounded-2xl border border-line bg-bg p-4 transition-shadow hover:shadow-md", compact && "p-3")}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={open} className="min-w-0 flex-1 text-left">
          <div className={cx("font-semibold leading-snug", compact ? "text-sm" : "text-[15px]")}>{w.title}</div>
        </button>
        <IconButton title={isSaved ? "取消儲存" : "儲存"} onClick={() => (isSaved ? unsaveWork(key) : saveWork(w))}>
          {isSaved ? <BookmarkCheck size={17} className="text-accent-strong" /> : <Bookmark size={17} />}
        </IconButton>
      </div>
      {reason && <div className="mt-1 line-clamp-3 text-sm text-ink-soft">{reason}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
        {"score" in w && w.score > 0 && <Badge tone="violet">匹配度 {w.score}%</Badge>}
        {tier && <Badge tone={tier === 1 ? "amber" : "gray"}>{TIER_LABEL[tier]}</Badge>}
        {inLib && <Badge tone="green">已在文獻庫</Badge>}
        <span className="truncate">
          {authors}
          {w.year ? ` · ${w.year}` : ""}
          {w.journal ? ` · ${w.journal}` : ""}
          {w.citedBy != null ? ` · 被引 ${w.citedBy}` : ""}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <button type="button" onClick={open} disabled={busy} className="inline-flex items-center gap-1 font-medium text-accent-strong hover:underline">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
          {inLib?.hasFile ? "開啟" : w.oaPdf ? "下載免費全文並開啟" : "加入待讀"}
        </button>
        {doiUrl(w) && (
          <a href={doiUrl(w)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-soft hover:underline">
            <ExternalLink size={13} /> {w.doi ? "DOI" : "連結"}
          </a>
        )}
      </div>
    </div>
  );
}

export function RelatedPanel({ paperId }: { paperId: string }) {
  const set = useReader((s) => s.set);
  const settings = useSettings();
  const rec = useLiveQuery(() => db.related.get(paperId), [paperId]);
  const [tab, setTab] = useState<"forYou" | "trending">("forYou");
  const [loading, setLoading] = useState(false);
  const items = rec?.[tab] ?? [];

  const refresh = async (mode = tab) => {
    setLoading(true);
    try {
      await refreshRelated(paperId, mode);
    } catch (e) {
      toast(`搜尋失敗：${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Overlay title="相關論文" onClose={() => set({ relatedOpen: false })}>
      <div className="mb-3 flex items-center gap-2">
        <Segmented
          className="flex-1"
          value={tab}
          onChange={(v) => {
            setTab(v);
            if (!rec?.[v]?.length) void refresh(v);
          }}
          options={[
            { value: "trending", label: "熱門" },
            { value: "forYou", label: "為你推薦" },
          ]}
        />
        <IconButton title="重新搜尋" onClick={() => refresh()}>
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </IconButton>
      </div>
      <label className="mb-3 flex items-center gap-2 text-xs text-ink-soft">
        <input type="checkbox" checked={settings.onlyWhitelist} onChange={(e) => saveSettings({ onlyWhitelist: e.target.checked })} />
        只看白名單期刊（改完按重新搜尋）
      </label>
      {rec?.note && <div className="mb-3 rounded-lg bg-muted p-3 text-xs text-ink-soft">{rec.note}</div>}
      {loading && !items.length && <div className="py-8 text-center text-sm text-ink-faint">搜尋中…</div>}
      {!loading && !items.length && !rec?.note && <div className="py-8 text-center text-sm text-ink-faint">還沒有結果，按右上角重新搜尋。</div>}
      <div className="space-y-3">
        {items.map((w) => (
          <WorkCard key={workKey(w)} w={w} />
        ))}
      </div>
    </Overlay>
  );
}

export function SavedPanel() {
  const set = useReader((s) => s.set);
  const saved = useLiveQuery(() => db.saved.orderBy("savedAt").reverse().filter((s) => !s.deleted).toArray(), []);
  return (
    <Overlay title="已儲存" onClose={() => set({ savedOpen: false })}>
      <p className="mb-3 text-xs text-ink-soft">沒有免費全文的論文會留在這裡。用學校 VPN 下載 PDF 後拖進文獻庫，系統會用 DOI 自動配對。</p>
      <div className="space-y-3">
        {(saved ?? []).map((s) => (
          <WorkCard key={s.id} w={s.meta} />
        ))}
        {saved && !saved.length && <div className="py-8 text-center text-sm text-ink-faint">還沒有儲存的論文</div>}
      </div>
    </Overlay>
  );
}

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-y-0 left-0 z-40 flex w-[min(440px,100%)] flex-col border-r border-line bg-soft shadow-[var(--shadow)]">
      <div className="flex items-center justify-between border-b border-line bg-bg px-4 py-3">
        <div className="font-semibold">{title}</div>
        <IconButton title="關閉" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="scroll-thin flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  );
}
