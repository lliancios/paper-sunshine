"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, ChevronRight, Folder, Globe, Layers, Moon, PanelLeftClose, Settings, Star, Sun, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { db } from "@/lib/db";
import { importPdf } from "@/lib/pipeline";
import { saveSettings, useSettings } from "@/lib/settings";
import { useReader } from "@/store/reader";
import { useApp } from "./AppFrame";
import { SunMark } from "./SunMark";
import { IconButton, Segmented, cx, relTime, toast } from "./ui";

export function LeftSidebar({ paperId, onCollapse }: { paperId?: string; onCollapse?: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"recent" | "folders">("recent");
  const [busy, setBusy] = useState(false);
  const settings = useSettings();
  const setApp = useApp((s) => s.set);
  const setReader = useReader((s) => s.set);

  const recent = useLiveQuery(
    () =>
      db.papers
        .orderBy("lastOpenedAt")
        .reverse()
        .filter((p) => !p.deleted && !!p.lastOpenedAt)
        .limit(25)
        .toArray(),
    [],
  );
  const folders = useLiveQuery(() => db.folders.filter((f) => !f.deleted).toArray(), []);
  const savedCount = useLiveQuery(() => db.saved.filter((s) => !s.deleted).count(), []);
  const related = useLiveQuery(() => (paperId ? db.related.get(paperId) : undefined), [paperId]);
  const job = useLiveQuery(() => (paperId ? db.jobs.get(paperId) : undefined), [paperId]);
  const top = related?.forYou[0];

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      let last = "";
      for (const f of Array.from(files)) last = await importPdf(f, f.name);
      if (last) router.push(`/read/${last}`);
    } catch (e) {
      toast(`匯入失敗：${e instanceof Error ? e.message : e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const dark = settings.theme === "dark" || (settings.theme === "system" && typeof window !== "undefined" && document.documentElement.classList.contains("dark"));

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-line bg-bg">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <Link href="/" className="flex items-center gap-2.5">
          <SunMark size={34} />
          <span className="text-[17px] font-semibold tracking-tight">Paper Sunshine</span>
        </Link>
        {onCollapse && (
          <IconButton title="收合側欄" onClick={onCollapse}>
            <PanelLeftClose size={18} />
          </IconButton>
        )}
      </div>

      <nav className="space-y-0.5 px-3 py-2 text-[15px]">
        <Link href="/" className="flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted">
          <BookOpen size={18} className="text-ink-soft" /> 開啟文獻庫
        </Link>
        <button type="button" onClick={() => setReader({ savedOpen: true, relatedOpen: false })} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted">
          <Star size={18} className="text-ink-soft" /> 已儲存
          {!!savedCount && <span className="ml-auto text-xs text-ink-faint">{savedCount}</span>}
        </button>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted">
          <Upload size={18} className="text-ink-soft" /> {busy ? "解析中…" : "上傳 PDF"}
        </button>
        <input ref={fileRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      </nav>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3">
        {paperId && (
          <section className="mb-4 mt-2">
            <div className="mb-2 px-1 text-xs font-medium text-ink-faint">相關論文</div>
            <button
              type="button"
              onClick={() => setReader({ relatedOpen: true, savedOpen: false })}
              className="w-full rounded-2xl border-2 border-ink/80 p-3.5 text-left transition-colors hover:bg-soft"
            >
              {top ? (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
                      匹配度 {top.score}%
                    </span>
                    <span className="h-2 w-2 rounded-full bg-accent" />
                  </div>
                  <div className="text-xs text-ink-faint">首選推薦</div>
                  <div className="line-clamp-2 text-sm font-semibold">{top.title}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-ink-soft">{top.reason}</div>
                  <div className="mt-2 flex items-center text-xs text-ink-soft">
                    還有 {Math.max(0, (related?.forYou.length ?? 1) - 1)} 篇 <ChevronRight size={14} />
                  </div>
                </>
              ) : (
                <div className="text-sm text-ink-soft">
                  {job?.stage === "related" ? "正在尋找相關論文…" : related?.note ?? "打開面板以搜尋相關論文"}
                </div>
              )}
            </button>
          </section>
        )}

        <section>
          <div className="mb-2 px-1 text-xs font-medium text-ink-faint">我的資料</div>
          <Segmented
            className="mb-2 w-full"
            value={tab}
            onChange={setTab}
            options={[
              { value: "recent", label: "最近" },
              { value: "folders", label: "資料夾" },
            ]}
          />
          {tab === "recent" && (
            <ul className="space-y-0.5">
              {(recent ?? []).map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/read/${p.id}`}
                    className={cx("flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-muted", p.id === paperId && "bg-muted")}
                  >
                    {p.hasFile ? <Layers size={17} className="mt-0.5 shrink-0 text-ink-faint" /> : <Globe size={17} className="mt-0.5 shrink-0 text-ink-faint" />}
                    <div className="min-w-0">
                      <div className="truncate text-sm">{p.title}</div>
                      <div className="text-xs text-ink-faint">{relTime(p.lastOpenedAt)}</div>
                    </div>
                  </Link>
                </li>
              ))}
              {recent && !recent.length && <li className="px-2 py-3 text-sm text-ink-faint">還沒有開過論文</li>}
            </ul>
          )}
          {tab === "folders" && (
            <ul className="space-y-0.5">
              {(folders ?? []).map((f) => (
                <li key={f.id}>
                  <Link href={`/?folder=${f.id}`} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-muted">
                    <Folder size={16} className="text-ink-faint" /> {f.name}
                  </Link>
                </li>
              ))}
              {folders && !folders.length && <li className="px-2 py-3 text-sm text-ink-faint">在文獻庫建立資料夾</li>}
            </ul>
          )}
        </section>
      </div>

      <div className="space-y-0.5 border-t border-line px-3 py-3 text-sm">
        <button type="button" onClick={() => setApp({ settingsOpen: true })} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted">
          <Settings size={17} className="text-ink-soft" /> 設定
        </button>
        <button
          type="button"
          onClick={() => saveSettings({ theme: dark ? "light" : "dark" })}
          className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted"
        >
          {dark ? <Sun size={17} className="text-ink-soft" /> : <Moon size={17} className="text-ink-soft" />}
          {dark ? "淺色模式" : "深色模式"}
        </button>
      </div>
    </aside>
  );
}
