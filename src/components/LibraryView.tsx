"use client";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertCircle,
  ChevronDown,
  Clock,
  ExternalLink,
  FolderPlus,
  Info,
  LayoutGrid,
  Library,
  List,
  Loader2,
  Moon,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Sun,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { type JobRec, type Paper, db, deletePaper, uid } from "@/lib/db";
import { addByDoi, importPdf } from "@/lib/pipeline";
import { saveSettings, useSettings } from "@/lib/settings";
import { useReader } from "@/store/reader";
import { useApp } from "./AppFrame";
import { SunMark } from "./SunMark";
import { Badge, Button, IconButton, Modal, Stars, cx, toast } from "./ui";
import { SavedPanel } from "./WorkPanels";

const PAGE_SIZE = 20;

export function LibraryView() {
  const router = useRouter();
  const params = useSearchParams();
  const folderId = params.get("folder");
  const settings = useSettings();
  const setApp = useApp((s) => s.set);
  const savedOpen = useReader((s) => s.savedOpen);
  const setReader = useReader((s) => s.set);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"list" | "cards">(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "cards" : "list"));
  const [sort, setSort] = useState<"added" | "recent">("added");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<{ minRating: number; tag: string; needsPdf: boolean }>({ minRating: 0, tag: "", needsPdf: false });
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [doiOpen, setDoiOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const papers = useLiveQuery(() => db.papers.filter((p) => !p.deleted).toArray(), []);
  const folders = useLiveQuery(() => db.folders.filter((f) => !f.deleted).toArray(), []);
  const jobs = useLiveQuery(() => db.jobs.toArray(), []);
  const jobMap = useMemo(() => new Map((jobs ?? []).map((j) => [j.paperId, j])), [jobs]);
  const folder = folders?.find((f) => f.id === folderId);

  const list = useMemo(() => {
    let l = papers ?? [];
    if (folderId) l = l.filter((p) => p.folderId === folderId);
    if (query.trim()) {
      const q = query.toLowerCase();
      l = l.filter((p) =>
        [p.title, p.titleZh, p.journal, p.doi, p.note, ...p.tags, ...p.authors.map((a) => a.display)].some((x) => x?.toLowerCase().includes(q)),
      );
    }
    if (filter.minRating) l = l.filter((p) => p.rating >= filter.minRating);
    if (filter.tag) l = l.filter((p) => p.tags.includes(filter.tag));
    if (filter.needsPdf) l = l.filter((p) => !p.hasFile);
    return [...l].sort((a, b) => (sort === "recent" ? (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) : b.addedAt - a.addedAt));
  }, [papers, folderId, query, filter, sort]);
  const allTags = useMemo(() => [...new Set((papers ?? []).flatMap((p) => p.tags))].sort(), [papers]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const shown = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const onFiles = async (files: FileList | File[] | null, attachTo?: Paper) => {
    const arr = Array.from(files ?? []).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!arr.length) return;
    for (const f of arr) {
      setBusy(f.name);
      try {
        const id = await importPdf(f, f.name, { folderId });
        if (attachTo && id !== attachTo.id) toast("PDF 的 DOI 與這筆資料不同，已另外建立一筆");
      } catch (e) {
        toast(`${f.name} 匯入失敗：${e instanceof Error ? e.message : e}`, "error");
      }
    }
    setBusy(null);
    toast(`已匯入 ${arr.length} 篇，背景翻譯中`);
  };

  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const update = (id: string, patch: Partial<Paper>) => db.papers.update(id, { ...patch, updatedAt: Date.now() });

  return (
    <div
      className="flex h-dvh"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void onFiles(e.dataTransfer.files);
      }}
    >
      {/* left nav */}
      <aside className="relative hidden w-[248px] shrink-0 flex-col border-r border-line bg-bg md:flex">
        <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
          <SunMark size={34} />
          <span className="text-[17px] font-semibold tracking-tight">Paper Sunshine</span>
        </div>
        <nav className="space-y-1 px-3 text-[15px]">
          <NavBtn icon={<Clock size={17} />} label="最近" active={sort === "recent" && !folderId} onClick={() => (setSort("recent"), router.push("/"))} />
          <NavBtn icon={<Search size={17} />} label="搜尋圖書館" onClick={() => searchRef.current?.focus()} />
          <NavBtn icon={<Star size={17} />} label="已儲存" onClick={() => setReader({ savedOpen: true })} />
          <div className="flex items-center">
            <NavBtn icon={<Library size={17} />} label="文獻庫" active={sort === "added" && !folderId} onClick={() => (setSort("added"), router.push("/"))} />
            <IconButton
              title="新增資料夾"
              className="ml-1 text-accent-strong"
              onClick={async () => {
                const name = prompt("資料夾名稱");
                if (name?.trim()) await db.folders.put({ id: uid(), name: name.trim(), createdAt: Date.now(), updatedAt: Date.now() });
              }}
            >
              <Plus size={16} />
            </IconButton>
          </div>
          <div className="ml-4 space-y-0.5 border-l border-line pl-2">
            {(folders ?? []).map((f) => (
              <Link key={f.id} href={`/?folder=${f.id}`} className={cx("block truncate rounded-md px-2 py-1.5 text-sm hover:bg-muted", f.id === folderId && "bg-muted font-medium")}>
                {f.name}
              </Link>
            ))}
          </div>
        </nav>
        <div className="mt-auto space-y-0.5 border-t border-line px-3 py-3 text-sm">
          <NavBtn icon={<Settings size={17} />} label="設定" onClick={() => setApp({ settingsOpen: true })} />
          <NavBtn icon={dark ? <Sun size={17} /> : <Moon size={17} />} label={dark ? "淺色模式" : "深色模式"} onClick={() => saveSettings({ theme: dark ? "light" : "dark" })} />
        </div>
        {savedOpen && <SavedPanel />}
      </aside>

      {/* main */}
      <main className="scroll-thin min-w-0 flex-1 overflow-y-auto bg-bg">
        <div className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 md:hidden">
              <SunMark size={28} />
            </div>
            <h1 className="text-2xl font-bold">{folder ? folder.name : "文獻庫"}</h1>
            <span title="文獻會存在這台裝置；v0.2.0 起跨裝置同步" className="text-ink-faint">
              <Info size={17} />
            </span>
            <div className="ml-auto flex items-center gap-2">
              <div className="inline-flex rounded-xl bg-muted p-1">
                <IconButton title="清單" active={view === "list"} onClick={() => setView("list")}>
                  <List size={17} />
                </IconButton>
                <IconButton title="卡片" active={view === "cards"} onClick={() => setView("cards")}>
                  <LayoutGrid size={17} />
                </IconButton>
              </div>
              <label className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5">
                <Search size={16} className="text-ink-faint" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => (setQuery(e.target.value), setPage(1))}
                  placeholder="搜尋標題、作者、標籤"
                  className="w-36 bg-transparent text-sm outline-none md:w-52"
                />
              </label>
              <div className="relative">
                <IconButton title="篩選" active={filterOpen || !!filter.minRating || !!filter.tag || filter.needsPdf} onClick={() => setFilterOpen((v) => !v)}>
                  <SlidersHorizontal size={17} />
                </IconButton>
                {filterOpen && (
                  <div className="absolute right-0 top-10 z-30 w-60 space-y-3 rounded-xl border border-line bg-bg p-3 text-sm shadow-[var(--shadow)]">
                    <div>
                      <div className="mb-1 text-xs text-ink-faint">最低評分</div>
                      <Stars value={filter.minRating} onChange={(v) => setFilter((f) => ({ ...f, minRating: v }))} />
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-ink-faint">標籤</div>
                      <select className="w-full rounded-md border border-line bg-bg px-2 py-1" value={filter.tag} onChange={(e) => setFilter((f) => ({ ...f, tag: e.target.value }))}>
                        <option value="">全部</option>
                        {allTags.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={filter.needsPdf} onChange={(e) => setFilter((f) => ({ ...f, needsPdf: e.target.checked }))} />
                      只看缺 PDF 的
                    </label>
                  </div>
                )}
              </div>
              <div className="relative flex">
                <button type="button" onClick={() => fileRef.current?.click()} className="rounded-l-lg bg-ink px-4 py-2 text-sm font-medium text-bg hover:opacity-90">
                  {busy ? "匯入中…" : "上傳論文"}
                </button>
                <button type="button" title="更多" onClick={() => setMenuOpen((v) => !v)} className="rounded-r-lg border-l border-bg/30 bg-ink px-2 text-bg hover:opacity-90">
                  <ChevronDown size={16} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-11 z-30 w-48 overflow-hidden rounded-xl border border-line bg-bg py-1 text-sm shadow-[var(--shadow)]" onMouseLeave={() => setMenuOpen(false)}>
                    <MenuItem onClick={() => (setMenuOpen(false), fileRef.current?.click())}>上傳 PDF</MenuItem>
                    <MenuItem onClick={() => (setMenuOpen(false), setDoiOpen(true))}>以 DOI 加入</MenuItem>
                    <MenuItem
                      onClick={async () => {
                        setMenuOpen(false);
                        const name = prompt("資料夾名稱");
                        if (name?.trim()) await db.folders.put({ id: uid(), name: name.trim(), createdAt: Date.now(), updatedAt: Date.now() });
                      }}
                    >
                      新增資料夾
                    </MenuItem>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
            </div>
          </div>

          {papers && !papers.length ? (
            <EmptyState onUpload={() => fileRef.current?.click()} />
          ) : view === "list" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-y border-line text-left text-ink-soft">
                    <th className="px-3 py-3 font-medium">標題</th>
                    <th className="w-36 px-3 py-3 font-medium">評分</th>
                    <th className="w-48 px-3 py-3 font-medium">註釋</th>
                    <th className="w-48 px-3 py-3 font-medium">標籤</th>
                    <th className="w-32 px-3 py-3 font-medium">添加時間</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <Row key={p.id} p={p} job={jobMap.get(p.id)} folders={folders ?? []} update={update} onAttach={(f) => onFiles(f, p)} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((p) => (
                <Card key={p.id} p={p} job={jobMap.get(p.id)} update={update} />
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="mt-6 flex justify-center gap-2">
              {Array.from({ length: pages }, (_, i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => setPage(i + 1)}
                  className={cx("h-10 w-10 rounded-xl text-sm", page === i + 1 ? "bg-muted font-semibold" : "text-ink-soft hover:bg-muted")}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
          <p className="mt-8 text-center text-xs text-ink-faint">可以直接把 PDF 拖進這個頁面。從相關論文加入、沒有全文的項目，拖入 PDF 後會依 DOI 自動配對。</p>
        </div>
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-accent/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-accent bg-bg px-8 py-6 text-lg font-medium">放開以匯入 PDF</div>
        </div>
      )}
      <DoiDialog open={doiOpen} onClose={() => setDoiOpen(false)} />
    </div>
  );
}

function NavBtn({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-muted", active && "bg-muted font-medium")}>
      <span className="text-ink-soft">{icon}</span>
      {label}
    </button>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="block w-full px-3 py-2 text-left hover:bg-muted">
      {children}
    </button>
  );
}

function statusOf(p: Paper, job?: JobRec) {
  if (!p.hasFile) return <Badge tone="amber">需要 PDF</Badge>;
  if (!job) return null;
  if (job.stage === "done") return null;
  if (job.stage === "error")
    return (
      <span title={job.error}>
        <Badge tone="red">
          <AlertCircle size={11} className="mr-1" /> 部分失敗
        </Badge>
      </span>
    );
  const label =
    job.stage === "translating" ? `翻譯中 ${job.pagesDone}/${job.pagesTotal}` : job.stage === "parsing" ? "解析中" : job.stage === "meta" ? "查詢書目" : job.stage === "overview" ? "建立術語表" : job.stage === "related" ? "找相關論文" : "排隊中";
  return (
    <Badge tone="violet">
      <Loader2 size={11} className="mr-1 animate-spin" /> {label}
    </Badge>
  );
}

function authorLine(p: Paper) {
  const a = p.authors.slice(0, 3).map((x) => x.family).join(", ") + (p.authors.length > 3 ? " et al." : "");
  return [a, p.year, p.journal].filter(Boolean).join(" · ");
}

function Row({
  p,
  job,
  folders,
  update,
  onAttach,
}: {
  p: Paper;
  job?: JobRec;
  folders: { id: string; name: string }[];
  update: (id: string, patch: Partial<Paper>) => void;
  onAttach: (f: FileList | null) => void;
}) {
  const router = useRouter();
  const attachRef = useRef<HTMLInputElement>(null);
  const open = () => (p.hasFile ? router.push(`/read/${p.id}`) : p.doi ? window.open(`https://doi.org/${p.doi}`, "_blank") : attachRef.current?.click());
  return (
    <tr className="group cursor-pointer border-b border-line hover:bg-soft" onClick={open}>
      <td className="max-w-0 px-3 py-3">
        <div className="truncate font-medium">{p.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint">
          {statusOf(p, job)}
          <span className="truncate">{authorLine(p)}</span>
          {!p.hasFile && (
            <button
              type="button"
              className="shrink-0 text-accent-strong hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                attachRef.current?.click();
              }}
            >
              上傳 PDF
            </button>
          )}
          <input ref={attachRef} type="file" accept="application/pdf" className="hidden" onClick={(e) => e.stopPropagation()} onChange={(e) => onAttach(e.target.files)} />
        </div>
      </td>
      <td className="px-3 py-3">
        <Stars value={p.rating} onChange={(v) => update(p.id, { rating: v })} />
      </td>
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <InlineEdit value={p.note} placeholder="" onSave={(v) => update(p.id, { note: v })} />
      </td>
      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
        <InlineEdit
          value={p.tags.join(", ")}
          placeholder=""
          render={p.tags.length ? <div className="flex flex-wrap gap-1">{p.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div> : undefined}
          onSave={(v) => update(p.id, { tags: v.split(/[,，]/).map((t) => t.trim()).filter(Boolean) })}
        />
      </td>
      <td className="px-3 py-3 text-ink-soft">{new Date(p.addedAt).toLocaleDateString("zh-TW")}</td>
      <td className="px-1 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
          <select
            title="移動到資料夾"
            className="w-7 appearance-none rounded bg-transparent text-transparent"
            value={p.folderId ?? ""}
            onChange={(e) => update(p.id, { folderId: e.target.value || null })}
            style={{ backgroundImage: "none" }}
          >
            <option value="">（無資料夾）</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <FolderPlus size={15} className="pointer-events-none -ml-6 mr-2 mt-0.5 text-ink-faint" />
          <button
            type="button"
            title="刪除"
            className="text-ink-faint hover:text-red-600"
            onClick={async () => {
              if (confirm(`刪除「${p.title}」？劃線與筆記也會一併刪除。`)) await deletePaper(p.id);
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function Card({ p, job, update }: { p: Paper; job?: JobRec; update: (id: string, patch: Partial<Paper>) => void }) {
  const router = useRouter();
  return (
    <div
      className="cursor-pointer rounded-2xl border border-line bg-bg p-4 transition-shadow hover:shadow-md"
      onClick={() => (p.hasFile ? router.push(`/read/${p.id}`) : p.doi && window.open(`https://doi.org/${p.doi}`, "_blank"))}
    >
      <div className="mb-2 flex items-center justify-between">
        {statusOf(p, job) ?? <span />}
        <Stars value={p.rating} onChange={(v) => update(p.id, { rating: v })} size={13} />
      </div>
      <div className="line-clamp-3 font-semibold leading-snug">{p.title}</div>
      {p.titleZh && <div className="mt-1 line-clamp-2 text-sm text-ink-soft">{p.titleZh}</div>}
      <div className="mt-2 truncate text-xs text-ink-faint">{authorLine(p)}</div>
      {!!p.tags.length && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      )}
      {!p.hasFile && p.doi && (
        <a href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="mt-2 inline-flex items-center gap-1 text-xs text-accent-strong">
          <ExternalLink size={12} /> 用 VPN 下載
        </a>
      )}
    </div>
  );
}

function InlineEdit({ value, onSave, placeholder, render }: { value: string; onSave: (v: string) => void; placeholder: string; render?: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  if (editing)
    return (
      <input
        autoFocus
        className="w-full rounded-md border border-accent bg-bg px-2 py-1 text-sm outline-none"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => (setEditing(false), v !== value && onSave(v))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    );
  return (
    <button type="button" className="min-h-7 w-full truncate rounded-md px-1 text-left text-ink-soft hover:bg-muted" onClick={() => (setV(value), setEditing(true))}>
      {render ?? (value || placeholder)}
    </button>
  );
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line py-20 text-center">
      <SunMark size={56} />
      <div className="mt-4 text-lg font-semibold">把第一篇論文拖進來</div>
      <p className="mt-1 max-w-md text-sm text-ink-soft">上傳後會在背景整篇翻譯、標出創新性、方法與結果，並找出相關論文。關掉網頁也沒關係，下次打開會從斷點續跑。</p>
      <Button variant="primary" className="mt-5" onClick={onUpload}>
        上傳 PDF
      </Button>
    </div>
  );
}

function DoiDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [doi, setDoi] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="以 DOI 加入" width={480}>
      <p className="mb-3 text-sm text-ink-soft">先建立書目。之後用 VPN 下載 PDF 拖進文獻庫，會自動配對到這一筆。</p>
      <input
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        placeholder="10.1509/jmkg.73.2.70"
        value={doi}
        onChange={(e) => setDoi(e.target.value)}
      />
      <div className="mt-4 flex justify-end">
        <Button
          variant="primary"
          disabled={!doi.trim() || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await addByDoi(doi);
              toast("已加入");
              setDoi("");
              onClose();
            } catch (e) {
              toast(`失敗：${e instanceof Error ? e.message : e}`, "error");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "查詢中…" : "加入"}
        </Button>
      </div>
    </Modal>
  );
}
