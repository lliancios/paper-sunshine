"use client";
// Zotero Web API (v3) through our /api/zotero proxy. The user's Zotero key is
// kept in this browser only (localStorage), never synced or stored server-side.
import { getPasscode } from "./api";
import type { WorkMeta } from "./apiTypes";
import { noteHtml } from "./zoteroNote";
import { type Paper, db, uid } from "./db";
import { importPdf, metaPatch } from "./pipeline";

export interface ZoteroCfg {
  userId: string;
  key: string;
  username?: string;
  canWrite?: boolean;
  files?: boolean;
}
const CFG = "ps-zotero";

export function getZotero(): ZoteroCfg | null {
  try {
    const v = localStorage.getItem(CFG);
    return v ? (JSON.parse(v) as ZoteroCfg) : null;
  } catch {
    return null;
  }
}
export function setZotero(c: ZoteroCfg | null) {
  try {
    if (c) localStorage.setItem(CFG, JSON.stringify(c));
    else localStorage.removeItem(CFG);
  } catch {
    /* ignore */
  }
}

async function z<T>(path: string, params: Record<string, string | number> = {}, init: RequestInit & { key?: string } = {}): Promise<{ data: T; total: number; version: number }> {
  const cfg = getZotero();
  const key = init.key ?? cfg?.key ?? "";
  const qs = new URLSearchParams({ path, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const r = await fetch(`/api/zotero?${qs}`, {
    ...init,
    headers: { "x-ps-pass": getPasscode(), "x-zotero-key": key, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    if (r.status === 403) throw new Error("Zotero 拒絕存取：金鑰沒有這個權限，或金鑰已失效");
    if (r.status === 404) throw new Error("Zotero 找不到這個項目");
    if (r.status === 429) throw new Error("Zotero 請求太頻繁，稍等一下再試");
    if (r.status === 401) throw new Error("網站密碼不正確");
    throw new Error(`Zotero 錯誤 ${r.status}：${text.slice(0, 120)}`);
  }
  const data = (r.status === 204 ? null : await r.json()) as T;
  return { data, total: Number(r.headers.get("x-total-results") || 0), version: Number(r.headers.get("x-last-version") || 0) };
}

/** Checks a key and remembers it with the account it belongs to. */
export async function connectZotero(key: string): Promise<ZoteroCfg> {
  const { data } = await z<{ userID: number; username?: string; access?: { user?: { library?: boolean; files?: boolean; write?: boolean } } }>("/keys/current", {}, { key: key.trim() });
  if (!data.access?.user?.library) throw new Error("這把金鑰沒有勾選「Allow library access」，請重新建立金鑰");
  const cfg: ZoteroCfg = { userId: String(data.userID), key: key.trim(), username: data.username, canWrite: !!data.access.user.write, files: !!data.access.user.files };
  setZotero(cfg);
  return cfg;
}

export interface ZCollection {
  key: string;
  name: string;
  parent: string | null;
  numItems: number;
}
export interface ZItem {
  key: string;
  itemType: string;
  title: string;
  creators: { creatorType: string; firstName?: string; lastName?: string; name?: string }[];
  date?: string;
  publicationTitle?: string;
  DOI?: string;
  ISSN?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  abstractNote?: string;
  url?: string;
  numChildren: number;
}

async function all<T>(path: string, extra: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < 5000; start += 100) {
    const { data, total } = await z<T[]>(path, { limit: 100, start, ...extra });
    out.push(...data);
    if (data.length < 100 || out.length >= total) break;
  }
  return out;
}

export async function listCollections(): Promise<ZCollection[]> {
  const cfg = getZotero()!;
  const raw = await all<{ key: string; data: { name: string; parentCollection: string | false }; meta: { numItems?: number } }>(`/users/${cfg.userId}/collections`);
  return raw.map((c) => ({ key: c.key, name: c.data.name, parent: c.data.parentCollection || null, numItems: c.meta.numItems ?? 0 })).sort((a, b) => a.name.localeCompare(b.name));
}

const SKIP = new Set(["attachment", "note", "annotation"]);
export async function listItems(collection: string | null): Promise<ZItem[]> {
  const cfg = getZotero()!;
  const path = collection ? `/users/${cfg.userId}/collections/${collection}/items/top` : `/users/${cfg.userId}/items/top`;
  const raw = await all<{ key: string; data: Omit<ZItem, "key" | "numChildren">; meta: { numChildren?: number } }>(path);
  return raw.filter((r) => !SKIP.has(r.data.itemType)).map((r) => ({ ...r.data, key: r.key, numChildren: r.meta.numChildren ?? 0 }));
}

async function pdfAttachment(itemKey: string): Promise<string | null> {
  const cfg = getZotero()!;
  const { data } = await z<{ key: string; data: { itemType: string; contentType?: string; linkMode?: string } }[]>(`/users/${cfg.userId}/items/${itemKey}/children`);
  const pdf = data.find((c) => c.data.itemType === "attachment" && c.data.contentType === "application/pdf" && /^imported_(file|url)$/.test(c.data.linkMode ?? ""));
  return pdf?.key ?? null;
}

async function downloadAttachment(attKey: string): Promise<Blob> {
  const cfg = getZotero()!;
  const r = await z<{ url?: string }>(`/users/${cfg.userId}/items/${attKey}/file`).catch(() => null);
  if (r?.data.url) {
    try {
      const direct = await fetch(r.data.url);
      if (direct.ok) return await direct.blob();
    } catch {
      /* storage host blocks the browser: go through our server */
    }
  }
  const qs = new URLSearchParams({ path: `/users/${cfg.userId}/items/${attKey}/file`, mode: "stream" });
  const s = await fetch(`/api/zotero?${qs}`, { headers: { "x-ps-pass": getPasscode(), "x-zotero-key": cfg.key } });
  if (!s.ok) throw new Error(s.status === 404 ? "Zotero 雲端沒有這個 PDF（可能只存在電腦上，沒開檔案同步）" : `下載 PDF 失敗（${s.status}）`);
  return s.blob();
}

export function toWorkMeta(it: ZItem): WorkMeta {
  const authors = it.creators
    .filter((c) => c.creatorType === "author" || c.creatorType === "editor")
    .map((c) => {
      const family = c.lastName ?? c.name ?? "";
      const given = c.firstName;
      return { family, given, display: [given, family].filter(Boolean).join(" ") || family };
    });
  const year = Number(/\b(19|20)\d{2}\b/.exec(it.date ?? "")?.[0]);
  const [firstPage, lastPage] = (it.pages ?? "").split(/[-–]/).map((x) => x.trim());
  return {
    title: it.title || "（未命名）",
    authors,
    year: Number.isFinite(year) ? year : undefined,
    journal: it.publicationTitle,
    issn: it.ISSN ? it.ISSN.split(/[,\s]+/).filter(Boolean) : undefined,
    volume: it.volume,
    issue: it.issue,
    firstPage: firstPage || undefined,
    lastPage: lastPage || undefined,
    doi: it.DOI?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase() || undefined,
    abstract: it.abstractNote,
    landing: it.url,
  };
}

export type ImportState = "waiting" | "downloading" | "imported" | "no-pdf" | "exists" | "error";
export interface ImportProgress {
  key: string;
  title: string;
  state: ImportState;
  message?: string;
}

/**
 * Imports Zotero items: PDFs are downloaded and processed; items without a PDF
 * become entries waiting for one. Triage mode = one-page summary first.
 */
export async function importFromZotero(items: ZItem[], opts: { folderId: string | null; triage: boolean; onProgress: (p: ImportProgress) => void }) {
  const cfg = getZotero()!;
  const existing = await db.papers.filter((p) => !p.deleted && !!p.zotero).toArray();
  const have = new Set(existing.map((p) => p.zotero!.key));
  for (const it of items) {
    const base = { key: it.key, title: it.title };
    if (have.has(it.key)) {
      opts.onProgress({ ...base, state: "exists" });
      continue;
    }
    const meta = toWorkMeta(it);
    const extra: Partial<Paper> = { zotero: { key: it.key, user: cfg.userId }, triage: opts.triage || undefined };
    try {
      opts.onProgress({ ...base, state: "downloading" });
      const att = it.numChildren ? await pdfAttachment(it.key) : null;
      if (att) {
        const blob = await downloadAttachment(att);
        const id = await importPdf(blob, `${it.title.slice(0, 80)}.pdf`, { meta, folderId: opts.folderId, extra, lookup: true });
        await db.papers.update(id, { ...extra, updatedAt: Date.now() }); // also when the PDF was already in the library
        opts.onProgress({ ...base, state: "imported" });
      } else {
        const dup = meta.doi ? await db.papers.where("doi").equals(meta.doi).filter((p) => !p.deleted).first() : undefined;
        if (dup) {
          await db.papers.update(dup.id, { ...extra, updatedAt: Date.now() });
          opts.onProgress({ ...base, state: "exists" });
        } else {
          const now = Date.now();
          await db.papers.put({
            id: uid(),
            addedAt: now,
            updatedAt: now,
            rating: 0,
            note: "",
            tags: [],
            folderId: opts.folderId,
            hasFile: false,
            metaDone: false,
            ...metaPatch(meta),
            ...extra,
          } as Paper);
          opts.onProgress({ ...base, state: "no-pdf", message: meta.doi ? "沒有 PDF，已用 DOI 建立，之後拖入 PDF 會自動配對" : "沒有 PDF" });
        }
      }
    } catch (e) {
      opts.onProgress({ ...base, state: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** Writes this paper's highlights and one-page summary back to Zotero as a child note. */
export async function saveNoteToZotero(paperId: string): Promise<"created" | "updated"> {
  const cfg = getZotero();
  if (!cfg) throw new Error("還沒連結 Zotero");
  if (!cfg.canWrite) throw new Error("這把 Zotero 金鑰沒有寫入權限（建立金鑰時要勾 Allow write access）");
  const paper = await db.papers.get(paperId);
  if (!paper?.zotero) throw new Error("這篇不是從 Zotero 匯入的");
  const html = await noteHtml(paperId);
  const note = { itemType: "note", parentItem: paper.zotero.key, note: html, tags: [{ tag: "Paper Sunshine" }] };
  if (paper.zotero.noteKey) {
    try {
      const r = await z<unknown>(`/users/${cfg.userId}/items/${paper.zotero.noteKey}`, {}, { method: "PATCH", body: JSON.stringify({ note: html }), headers: { "if-unmodified-since-version": String(paper.zotero.noteVersion ?? 0) } });
      await db.papers.update(paperId, { zotero: { ...paper.zotero, noteVersion: r.version || (paper.zotero.noteVersion ?? 0) + 1 }, updatedAt: Date.now() });
      return "updated";
    } catch {
      /* note deleted or edited in Zotero: create a fresh one */
    }
  }
  const { data } = await z<{ successful?: Record<string, { key: string; version: number }>; failed?: Record<string, { message: string }> }>(`/users/${cfg.userId}/items`, {}, { method: "POST", body: JSON.stringify([note]) });
  const ok = data.successful?.["0"];
  if (!ok) throw new Error(data.failed?.["0"]?.message ?? "Zotero 沒有建立筆記");
  await db.papers.update(paperId, { zotero: { ...paper.zotero, noteKey: ok.key, noteVersion: ok.version }, updatedAt: Date.now() });
  return "created";
}
