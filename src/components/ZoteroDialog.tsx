"use client";
import { CheckCircle2, CircleAlert, ExternalLink, FileX, Folder, Library, Loader2, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { db, uid } from "@/lib/db";
import { type ImportProgress, type ZCollection, type ZItem, connectZotero, getZotero, importFromZotero, listCollections, listItems, setZotero } from "@/lib/zotero";
import { Button, Modal, cx, toast } from "./ui";

const KEY_URL = "https://www.zotero.org/settings/keys/new";

/**
 * 從 Zotero 匯入: connect with an API key, pick collections or items, import
 * them in bulk. Triage mode gives every paper a one-page summary first, so a
 * hoarded collection becomes a list you can actually skim.
 */
export function ZoteroDialog({ open, onClose, folderId }: { open: boolean; onClose: () => void; folderId: string | null }) {
  const [cfg, setCfg] = useState(getZotero);
  useEffect(() => {
    if (open) setCfg(getZotero());
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="從 Zotero 匯入" width={880}>
      {cfg ? <Picker onClose={onClose} folderId={folderId} onDisconnect={() => (setZotero(null), setCfg(null))} /> : <Connect onConnected={setCfg} />}
    </Modal>
  );
}

function Connect({ onConnected }: { onConnected: (c: ReturnType<typeof getZotero>) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="max-w-xl space-y-4 text-sm">
      <p className="text-ink-soft">連結一次，就能把 Zotero 裡存了還沒讀的論文整批拿進來：自動翻譯標題、標出重點、產生一頁速覽，讀完的劃線與速覽還能存回 Zotero。</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          打開{" "}
          <a href={KEY_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent-strong underline">
            Zotero 建立金鑰頁 <ExternalLink size={12} />
          </a>
          （要先登入 zotero.org）。
        </li>
        <li>
          Key Description 填 <code>Paper Sunshine</code>；在 Personal Library 勾選 <b>Allow library access</b> 和 <b>Allow notes access</b>；想把筆記存回 Zotero 就再勾 <b>Allow write access</b>。
        </li>
        <li>按 Save Key，把出現的那串金鑰貼到下面。</li>
      </ol>
      <div className="flex gap-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Zotero API 金鑰"
          className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
        <Button
          variant="primary"
          disabled={!key.trim() || busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              const c = await connectZotero(key);
              toast(`已連結 Zotero${c.username ? `：${c.username}` : ""}`);
              onConnected(c);
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 size={14} className="animate-spin" />} 連結
        </Button>
      </div>
      {err && <p className="text-red-600">{err}</p>}
      <p className="text-xs text-ink-faint">
        金鑰只存在這台裝置的瀏覽器裡，不會上傳到同步雲端。PDF 要在 Zotero 開啟「檔案同步」（Zotero 儲存空間）才下載得到；沒有 PDF 的項目會先用 DOI 建立，之後拖入 PDF 會自動配對。
      </p>
    </div>
  );
}

function Picker({ onClose, folderId, onDisconnect }: { onClose: () => void; folderId: string | null; onDisconnect: () => void }) {
  const cfg = getZotero()!;
  const [collections, setCollections] = useState<ZCollection[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null); // null = whole library
  const [items, setItems] = useState<ZItem[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [triage, setTriage] = useState(true);
  const [makeFolder, setMakeFolder] = useState(true);
  const [progress, setProgress] = useState<Map<string, ImportProgress>>(new Map());
  const [running, setRunning] = useState(false);

  useEffect(() => {
    listCollections()
      .then(setCollections)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    void db.papers
      .filter((p) => !p.deleted && !!p.zotero)
      .toArray()
      .then((ps) => setImported(new Set(ps.map((p) => p.zotero!.key))));
  }, []);

  useEffect(() => {
    setItems(null);
    setErr("");
    listItems(current)
      .then((it) => {
        setItems(it);
        setPicked(new Set(it.filter((i) => !imported.has(i.key)).map((i) => i.key)));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // Collections as an indented tree.
  const tree = useMemo(() => {
    const out: { c: ZCollection; depth: number }[] = [];
    const kids = (p: string | null, depth: number) => {
      for (const c of (collections ?? []).filter((x) => x.parent === p)) {
        out.push({ c, depth });
        kids(c.key, depth + 1);
      }
    };
    kids(null, 0);
    return out;
  }, [collections]);

  const currentName = current ? (collections?.find((c) => c.key === current)?.name ?? "") : "整個文獻庫";
  const run = async () => {
    if (!items) return;
    setRunning(true);
    let target = folderId;
    if (makeFolder && current) {
      const name = `Zotero｜${currentName}`;
      const existing = await db.folders.filter((f) => !f.deleted && f.name === name).first();
      if (existing) target = existing.id;
      else {
        const now = Date.now();
        target = uid();
        await db.folders.put({ id: target, name, createdAt: now, updatedAt: now });
      }
    }
    const chosen = items.filter((i) => picked.has(i.key));
    await importFromZotero(chosen, {
      folderId: target,
      triage,
      onProgress: (p) => setProgress((m) => new Map(m).set(p.key, p)),
    });
    setRunning(false);
    setImported((s) => new Set([...s, ...chosen.map((c) => c.key)]));
    toast(triage ? `已匯入 ${chosen.length} 篇，正在逐篇產生一頁速覽` : `已匯入 ${chosen.length} 篇，背景翻譯中`);
  };

  const done = [...progress.values()];
  const counts = {
    ok: done.filter((p) => p.state === "imported").length,
    noPdf: done.filter((p) => p.state === "no-pdf").length,
    exists: done.filter((p) => p.state === "exists").length,
    error: done.filter((p) => p.state === "error").length,
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <CheckCircle2 size={14} className="text-emerald-600" /> 已連結 Zotero{cfg.username ? `：${cfg.username}` : ""}
        {!cfg.canWrite && <span>（唯讀，不能存回筆記）</span>}
        <button type="button" onClick={onDisconnect} className="ml-auto inline-flex items-center gap-1 hover:text-ink">
          <LogOut size={12} /> 中斷連結
        </button>
      </div>
      {err && <div className="rounded-lg bg-red-50 p-2 text-red-700 dark:bg-red-950 dark:text-red-300">{err}</div>}
      <div className="flex min-h-[380px] flex-col gap-3 md:flex-row">
        <nav className="scroll-thin max-h-[420px] shrink-0 overflow-y-auto rounded-xl border border-line p-1.5 md:w-56">
          <button type="button" onClick={() => setCurrent(null)} className={cx("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left", current === null ? "bg-accent-soft text-accent-strong" : "hover:bg-muted")}>
            <Library size={14} /> 整個文獻庫
          </button>
          {!collections && !err && <div className="px-2 py-2 text-xs text-ink-faint">讀取收藏夾…</div>}
          {tree.map(({ c, depth }) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCurrent(c.key)}
              style={{ paddingLeft: 8 + depth * 14 }}
              className={cx("flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left", current === c.key ? "bg-accent-soft text-accent-strong" : "hover:bg-muted")}
            >
              <Folder size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-xs text-ink-faint">{c.numItems}</span>
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-line">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs">
            <span className="font-medium">{currentName}</span>
            {items && (
              <>
                <span className="text-ink-faint">{items.length} 篇，已選 {picked.size}</span>
                <button type="button" className="ml-auto text-accent-strong hover:underline" onClick={() => setPicked(new Set(items.filter((i) => !imported.has(i.key)).map((i) => i.key)))}>
                  全選未匯入
                </button>
                <button type="button" className="text-ink-soft hover:underline" onClick={() => setPicked(new Set())}>
                  全不選
                </button>
              </>
            )}
          </div>
          <div className="scroll-thin max-h-[380px] flex-1 overflow-y-auto">
            {!items && !err && (
              <div className="flex items-center gap-2 p-3 text-ink-faint">
                <Loader2 size={14} className="animate-spin" /> 讀取項目…
              </div>
            )}
            {items?.length === 0 && <div className="p-3 text-ink-faint">這個收藏夾沒有論文。</div>}
            {items?.map((it) => {
              const p = progress.get(it.key);
              const was = imported.has(it.key);
              const y = /\b(19|20)\d{2}\b/.exec(it.date ?? "")?.[0];
              const first = it.creators[0];
              return (
                <label key={it.key} className="flex cursor-pointer items-start gap-2 border-b border-line px-3 py-2 last:border-0 hover:bg-soft">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={running}
                    checked={picked.has(it.key)}
                    onChange={(e) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(it.key);
                        else n.delete(it.key);
                        return n;
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2">{it.title}</div>
                    <div className="truncate text-xs text-ink-faint">
                      {[first ? (first.lastName ?? first.name) + (it.creators.length > 1 ? " et al." : "") : "", y, it.publicationTitle].filter(Boolean).join(" · ")}
                      {!it.numChildren && " · 沒有附件"}
                    </div>
                  </div>
                  <div className="shrink-0 pt-0.5 text-xs">
                    {p ? <StateBadge p={p} /> : was ? <span className="text-ink-faint">已在文獻庫</span> : null}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-soft px-3 py-2.5 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={triage} onChange={(e) => setTriage(e.target.checked)} />
          <span>
            <b>批次整理模式</b>
            <span className="text-ink-soft">：每篇先產生導讀、自動高亮與一頁速覽（省額度），全文翻譯等你打開那篇才做</span>
          </span>
        </label>
        {current && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={makeFolder} onChange={(e) => setMakeFolder(e.target.checked)} />
            放進資料夾「Zotero｜{currentName}」
          </label>
        )}
      </div>
      <div className="flex items-center gap-3">
        {done.length > 0 && (
          <span className="text-xs text-ink-soft">
            完成 {counts.ok}　沒有 PDF {counts.noPdf}　已存在 {counts.exists}
            {counts.error ? `　失敗 ${counts.error}` : ""}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button onClick={onClose}>{done.length ? "完成" : "取消"}</Button>
          <Button variant="primary" disabled={!picked.size || running || !items} onClick={() => void run()}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {running ? "匯入中…" : `匯入 ${picked.size} 篇`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StateBadge({ p }: { p: ImportProgress }) {
  if (p.state === "downloading") return <Loader2 size={14} className="animate-spin text-ink-faint" />;
  if (p.state === "imported") return <span className="text-emerald-600">已匯入</span>;
  if (p.state === "exists") return <span className="text-ink-faint">已存在</span>;
  if (p.state === "no-pdf")
    return (
      <span className="inline-flex items-center gap-1 text-amber-700" title={p.message}>
        <FileX size={12} /> 缺 PDF
      </span>
    );
  if (p.state === "error")
    return (
      <span className="inline-flex items-center gap-1 text-red-600" title={p.message}>
        <CircleAlert size={12} /> 失敗
      </span>
    );
  return null;
}
