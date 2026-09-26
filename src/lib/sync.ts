"use client";
// Cross-device sync (computer, iPad, phone) through the user's own Supabase
// project. Local IndexedDB stays the source of truth for the UI; this module
// mirrors it to one Postgres table (`ps_records`) plus a private storage bucket
// for PDFs and parsed layout models.
//
// - Every local write is caught by Dexie hooks and queued in `outbox`.
// - Push: rows go through the `ps_push` RPC, which never lets an older write
//   overwrite a newer one (last writer wins on `updated_at`).
// - Pull: rows changed since the last cursor (server clock `rev`), applied in a
//   transaction flagged as remote so the hooks do not echo them back.
// - Machine output (translations, auto highlights, page status) travels as one
//   "gen" bundle per paper and is merged by union; `resetTranslations` bumps an
//   epoch so a deliberate re-translation replaces instead of merging.
// - PDFs and models download lazily (when a paper is opened or processed) plus
//   a background prefetch of recent papers for offline reading.
import type { RealtimeChannel, Session, SupabaseClient } from "@supabase/supabase-js";
import Dexie, { type Table, type Transaction } from "dexie";
import { create } from "zustand";
import type { DocModel } from "@/engine/types";
import { type OutboxRec, db, purgePaperData } from "./db";

export interface SyncConfig {
  url: string;
  key: string;
}
const CFG_KEY = "ps-sync-config";
const BUCKET = "ps-files";

// ------------------------------------------------------------- status ----

export type SyncPhase = "off" | "signedOut" | "idle" | "syncing" | "error" | "offline";
interface SyncStatus {
  configured: boolean;
  email: string | null;
  phase: SyncPhase;
  lastSync: number | null;
  pending: number;
  message: string;
  set: (p: Partial<SyncStatus>) => void;
}
export const useSync = create<SyncStatus>((set) => ({
  configured: false,
  email: null,
  phase: "off",
  lastSync: null,
  pending: 0,
  message: "",
  set: (p) => set(p),
}));
const status = (p: Partial<SyncStatus>) => useSync.getState().set(p);

// ------------------------------------------------------ table registry ----

type AnyRec = Record<string, unknown>;
interface RowSpec {
  key: (r: AnyRec) => string;
  paper?: (r: AnyRec) => string | undefined;
  updated: (r: AnyRec) => number;
}
const byId = (r: AnyRec) => r.id as string;
const byPaper = (r: AnyRec) => r.paperId as string;
const upd = (r: AnyRec) => (r.updatedAt as number) ?? 0;
const at = (r: AnyRec) => (r.at as number) ?? 0;

/** Tables mirrored row by row (the table name is also the remote `tbl`). */
const ROWS: Record<string, RowSpec> = {
  papers: { key: byId, paper: byId, updated: upd },
  highlights: { key: byId, paper: byPaper, updated: upd },
  explanations: { key: byId, paper: byPaper, updated: upd },
  chats: { key: byId, paper: byPaper, updated: upd },
  ink: { key: byId, paper: byPaper, updated: upd },
  notes: { key: byPaper, paper: byPaper, updated: upd },
  overviews: { key: byPaper, paper: byPaper, updated: at },
  onepagers: { key: byPaper, paper: byPaper, updated: at },
  quizzes: { key: byPaper, paper: byPaper, updated: at },
  related: { key: byPaper, paper: byPaper, updated: at },
  folders: { key: byId, updated: upd },
  saved: { key: byId, updated: upd },
  settings: { key: (r) => r.key as string, updated: upd },
  projects: { key: byId, updated: upd },
  docs: { key: byId, updated: upd },
};
const GEN_TABLES = ["translations", "autohl", "pageStatus"] as const;

interface RemoteRow {
  tbl: string;
  id: string;
  paper_id?: string | null;
  data: unknown;
  deleted: boolean;
  updated_at: number;
  rev?: number;
}
interface GenData {
  epoch: number;
  t: Record<string, string>;
  c: Record<string, string>;
  pages: number[];
}
interface ModelStamp {
  at: number;
  gz: boolean;
}

// ------------------------------------------------------------ plumbing ----

let client: SupabaseClient | null = null;
let session: Session | null = null;
let channel: RealtimeChannel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let recording = false;

function readCfg(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    return raw ? (JSON.parse(raw) as SyncConfig) : null;
  } catch {
    return null;
  }
}

const uidOf = () => session?.user.id ?? "";
const pathOf = (paperId: string, file: string) => `${uidOf()}/${paperId}/${file}`;

type RemoteTx = Transaction & { __psRemote?: boolean; parent?: RemoteTx | null };
function isRemote(t?: Transaction | null) {
  for (const start of [t, Dexie.currentTransaction] as (RemoteTx | null | undefined)[]) {
    for (let x = start; x; x = x.parent) if (x.__psRemote) return true;
  }
  return false;
}

/** Runs DB writes that came from the cloud without queueing them for push. */
async function applyRemote(fn: () => Promise<void>) {
  const tables = [...Object.keys(ROWS), ...GEN_TABLES, "files", "models", "jobs", "syncState", "refs"].map((n) => db.table(n));
  await db.transaction("rw", tables, async () => {
    (Dexie.currentTransaction as RemoteTx).__psRemote = true;
    await fn();
  });
}

// ------------------------------------------------------- change capture ----

const dirty = new Map<string, { tbl: string; id: string }>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
function mark(tbl: string, id: string | undefined) {
  if (!recording || !id) return;
  dirty.set(`${tbl}:${id}`, { tbl, id });
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flushDirty(), 250);
}
async function flushDirty() {
  if (!dirty.size) return;
  const items = [...dirty.values()];
  dirty.clear();
  const now = Date.now();
  await db.outbox.bulkPut(items.map((i) => ({ key: `${i.tbl}:${i.id}`, tbl: i.tbl, id: i.id, at: now })));
  status({ pending: await db.outbox.count() });
  schedulePush();
}

let hooked = false;
function installHooks() {
  if (hooked) return;
  hooked = true;
  for (const [name, spec] of Object.entries(ROWS)) {
    const t = db.table(name);
    t.hook("creating", (_pk, obj, trans) => {
      if (!isRemote(trans)) mark(name, spec.key(obj as AnyRec));
    });
    t.hook("updating", (_mods, _pk, obj, trans) => {
      if (!isRemote(trans)) mark(name, spec.key(obj as AnyRec));
    });
  }
  for (const name of GEN_TABLES) {
    const t = db.table(name);
    const f = (obj: unknown, trans: Transaction) => {
      if (!isRemote(trans)) mark("gen", (obj as AnyRec | undefined)?.paperId as string | undefined);
    };
    t.hook("creating", (_pk, obj, trans) => f(obj, trans));
    t.hook("updating", (_mods, _pk, obj, trans) => f(obj, trans));
    t.hook("deleting", (_pk, obj, trans) => f(obj, trans));
  }
  db.files.hook("creating", (_pk, obj, trans) => {
    if (!isRemote(trans)) mark("file", obj.paperId);
  });
  db.files.hook("updating", (_mods, _pk, obj, trans) => {
    if (!isRemote(trans)) mark("file", obj.paperId);
  });
  db.models.hook("creating", (_pk, obj, trans) => {
    if (isRemote(trans)) return;
    obj.at = Date.now();
    mark("model", obj.paperId);
  });
  db.models.hook("updating", (mods, _pk, obj, trans) => {
    if (isRemote(trans)) return;
    mark("model", obj.paperId);
    return "at" in (mods as AnyRec) ? undefined : { at: Date.now() };
  });
}

// ------------------------------------------------------------------ push ----

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let pushing: Promise<void> | null = null;
let pushAgain = false;
function schedulePush(delay = 2000) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), delay);
}

async function genRow(paperId: string): Promise<RemoteRow | null> {
  const [trans, hl, ps, ep] = await Promise.all([
    db.translations.where("paperId").equals(paperId).toArray(),
    db.autohl.where("paperId").equals(paperId).toArray(),
    db.pageStatus.where("paperId").equals(paperId).toArray(),
    db.syncState.get(`epoch:${paperId}`),
  ]);
  const t: Record<string, string> = {};
  const c: Record<string, string> = {};
  const mockPages = new Set<number>();
  for (const r of trans) {
    if (r.mock) mockPages.add(r.page);
    else if (r.t) t[r.sid] = r.t;
    if (r.c) c[r.sid] = r.c;
  }
  for (const r of hl) c[r.sid] = r.c;
  const pages = ps.filter((s) => s.done && !mockPages.has(s.page)).map((s) => s.page);
  const epoch = (ep?.value as number) ?? 0;
  if (!Object.keys(t).length && !Object.keys(c).length && !pages.length && !epoch) return null;
  const data: GenData = { epoch, t, c, pages };
  return { tbl: "gen", id: paperId, paper_id: paperId, data, deleted: false, updated_at: Date.now() };
}

async function gzip(text: string): Promise<{ blob: Blob; gz: boolean }> {
  if (typeof CompressionStream === "undefined") return { blob: new Blob([text], { type: "application/json" }), gz: false };
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  // Opaque type so no server or browser layer decides to unzip it on the way.
  return { blob: new Blob([await new Response(stream).arrayBuffer()], { type: "application/octet-stream" }), gz: true };
}
async function gunzip(blob: Blob): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const isGz = head[0] === 0x1f && head[1] === 0x8b; // trust the bytes (a proxy may already have unzipped it)
  if (!isGz) return blob.text();
  return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

async function uploadFile(paperId: string) {
  const f = await db.files.get(paperId);
  if (!f || !client) return;
  const { data: list } = await client.storage.from(BUCKET).list(`${uidOf()}/${paperId}`);
  const existing = list?.find((o) => o.name === "paper.pdf");
  if (existing && (existing.metadata as { size?: number } | null)?.size === f.blob.size) return;
  const { error } = await client.storage.from(BUCKET).upload(pathOf(paperId, "paper.pdf"), f.blob, { upsert: true, contentType: "application/pdf" });
  if (error) throw error;
}

async function uploadModel(paperId: string): Promise<RemoteRow | null> {
  const rec = await db.models.get(paperId);
  if (!rec || !client) return null;
  const stamp = rec.at ?? Date.now();
  const { blob, gz } = await gzip(JSON.stringify(rec.model));
  const { error } = await client.storage
    .from(BUCKET)
    .upload(pathOf(paperId, gz ? "model.json.gz" : "model.json"), blob, { upsert: true, contentType: gz ? "application/gzip" : "application/json" });
  if (error) throw error;
  const data: ModelStamp = { at: stamp, gz };
  return { tbl: "model", id: paperId, paper_id: paperId, data, deleted: false, updated_at: stamp };
}

async function rowFor(tbl: string, id: string): Promise<RemoteRow | null> {
  const spec = ROWS[tbl];
  const rec = (await db.table(tbl).get(id)) as AnyRec | undefined;
  if (!rec) return null;
  return { tbl, id, paper_id: spec.paper?.(rec) ?? null, data: rec, deleted: !!rec.deleted, updated_at: spec.updated(rec) || Date.now() };
}

/** After a paper tombstone reaches the cloud: drop its files and child rows there too. */
async function cleanupRemotePaper(paperId: string) {
  if (!client) return;
  await client.storage.from(BUCKET).remove(["paper.pdf", "model.json.gz", "model.json"].map((f) => pathOf(paperId, f)));
  await client.from("ps_records").delete().eq("paper_id", paperId).neq("tbl", "papers");
}

function chunks(rows: RemoteRow[], maxBytes = 900_000): RemoteRow[][] {
  const out: RemoteRow[][] = [];
  let cur: RemoteRow[] = [];
  let size = 0;
  for (const r of rows) {
    const n = JSON.stringify(r).length;
    if (cur.length && size + n > maxBytes) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(r);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

function explain(e: unknown): string {
  const err = e as { message?: string; code?: string; statusCode?: string | number };
  const msg = err?.message ?? String(e);
  if (err?.code === "PGRST202" || err?.code === "PGRST205" || err?.code === "42P01" || /ps_push|ps_records/.test(msg))
    return "雲端資料表還沒建立：請在 Supabase 的 SQL Editor 執行 supabase/schema.sql";
  if (/bucket not found/i.test(msg)) return "雲端檔案空間還沒建立：請在 Supabase 的 SQL Editor 執行 supabase/schema.sql";
  if (/jwt|token|auth/i.test(msg)) return "登入已過期，請重新登入同步";
  if (/fetch|network|load failed/i.test(msg)) return "連不到 Supabase，稍後會自動重試";
  return msg;
}

async function pushOnce() {
  if (!client || !session) return;
  for (let round = 0; round < 200; round++) {
    const batch = await db.outbox.orderBy("at").limit(40).toArray();
    if (!batch.length) break;
    const rows: RemoteRow[] = [];
    const done: OutboxRec[] = [];
    const tombstones: string[] = [];
    for (const e of batch) {
      status({ message: e.tbl === "file" ? "上傳 PDF…" : "上傳變更…" });
      if (e.tbl === "file") await uploadFile(e.id);
      else if (e.tbl === "model") {
        const r = await uploadModel(e.id);
        if (r) rows.push(r);
      } else if (e.tbl === "gen") {
        const r = await genRow(e.id);
        if (r) rows.push(r);
      } else if (ROWS[e.tbl]) {
        const r = await rowFor(e.tbl, e.id);
        if (r) {
          rows.push(r);
          if (e.tbl === "papers" && r.deleted) tombstones.push(e.id);
        }
      }
      done.push(e);
    }
    for (const part of chunks(rows)) {
      const { error } = await client.rpc("ps_push", { rows: part });
      if (error) throw error;
    }
    for (const id of tombstones) await cleanupRemotePaper(id).catch(() => {});
    await db.transaction("rw", db.outbox, async () => {
      for (const e of done) {
        const cur = await db.outbox.get(e.key);
        if (cur && cur.at === e.at) await db.outbox.delete(e.key);
      }
    });
    status({ pending: await db.outbox.count() });
  }
}

export async function push() {
  if (pushing) {
    pushAgain = true;
    return pushing;
  }
  if (!client || !session) return;
  if (!navigator.onLine) return status({ phase: "offline" });
  pushing = (async () => {
    try {
      await flushDirty();
      status({ phase: "syncing" });
      await pushOnce();
      status({ phase: "idle", lastSync: Date.now(), message: "" });
    } catch (e) {
      status({ phase: "error", message: explain(e) });
      schedulePush(30_000);
    } finally {
      pushing = null;
      if (pushAgain) {
        pushAgain = false;
        schedulePush(500);
      }
    }
  })();
  return pushing;
}

// ------------------------------------------------------------------ pull ----

const staleModels = new Set<string>();

async function applyRow(r: RemoteRow) {
  if (r.tbl === "gen") return applyGen(r.id, r.data as GenData);
  if (r.tbl === "model") {
    const stamp = r.data as ModelStamp;
    await db.syncState.put({ key: `model:${r.id}`, value: stamp });
    const local = await db.models.get(r.id);
    if (local && (local.at ?? 0) < stamp.at) staleModels.add(r.id);
    return;
  }
  const spec = ROWS[r.tbl];
  if (!spec) return;
  const table = db.table(r.tbl) as Table<AnyRec, string>;
  const local = await table.get(r.id);
  if (local && spec.updated(local) >= r.updated_at) return; // ours is newer (it will be pushed)
  if (r.tbl === "papers") {
    const paper = r.data as AnyRec;
    if (paper.deleted && local && !local.deleted) await purgePaperData(r.id);
    if (!local && !paper.deleted) {
      // A paper from another device: don't start processing it here until it is opened.
      await db.jobs.put({ paperId: r.id, stage: "done", pagesDone: 0, pagesTotal: 0, updatedAt: Date.now() });
    }
  }
  await table.put(r.data as AnyRec);
}

async function applyGen(paperId: string, remote: GenData) {
  const ep = await db.syncState.get(`epoch:${paperId}`);
  const localEpoch = (ep?.value as number) ?? 0;
  if (localEpoch > remote.epoch) return mark("gen", paperId); // our reset wins; push it
  const replace = remote.epoch > localEpoch;
  if (replace) {
    await db.translations.where("paperId").equals(paperId).delete();
    await db.autohl.where("paperId").equals(paperId).delete();
    await db.pageStatus.where("paperId").equals(paperId).delete();
    await db.syncState.put({ key: `epoch:${paperId}`, value: remote.epoch });
  }
  const pageOf = (sid: string) => Number.parseInt(sid, 10);
  const [trans, hl, ps] = await Promise.all([
    db.translations.where("paperId").equals(paperId).toArray(),
    db.autohl.where("paperId").equals(paperId).toArray(),
    db.pageStatus.where("paperId").equals(paperId).toArray(),
  ]);
  const haveT = new Map(trans.map((r) => [r.sid, r]));
  const haveC = new Set(hl.map((r) => r.sid));
  const haveP = new Set(ps.filter((p) => p.done).map((p) => p.page));

  const putT = Object.entries(remote.t ?? {})
    .filter(([sid]) => {
      const cur = haveT.get(sid);
      return !cur || !cur.t || cur.mock;
    })
    .map(([sid, t]) => ({ paperId, sid, page: pageOf(sid), t, c: haveT.get(sid)?.c ?? null }));
  const putC = Object.entries(remote.c ?? {})
    .filter(([sid]) => !haveC.has(sid))
    .map(([sid, c]) => ({ paperId, sid, c }));
  const now = Date.now();
  const putP = (remote.pages ?? []).filter((p) => !haveP.has(p)).map((page) => ({ paperId, page, done: true, at: now }));
  if (putT.length) await db.translations.bulkPut(putT);
  if (putC.length) await db.autohl.bulkPut(putC);
  if (putP.length) await db.pageStatus.bulkPut(putP);

  // We know things the cloud does not: send the union back.
  const remoteT = remote.t ?? {};
  const extra =
    trans.some((r) => r.t && !r.mock && !(r.sid in remoteT)) ||
    hl.some((r) => !(r.sid in (remote.c ?? {}))) ||
    ps.some((p) => p.done && !(remote.pages ?? []).includes(p.page));
  if (!replace && extra) mark("gen", paperId);
}

let pulling: Promise<void> | null = null;
export async function pull() {
  if (pulling) return pulling;
  if (!client || !session) return;
  if (!navigator.onLine) return status({ phase: "offline" });
  pulling = (async () => {
    try {
      status({ phase: "syncing", message: "下載變更…" });
      const key = `cursor:${uidOf()}`;
      const cursor = ((await db.syncState.get(key))?.value as number) ?? 0;
      let after = Math.max(0, cursor - 15_000); // overlap: late commits are never skipped
      let maxRev = cursor;
      for (let page = 0; page < 1000; page++) {
        const { data, error } = await client!
          .from("ps_records")
          .select("tbl,id,paper_id,data,deleted,updated_at,rev")
          .gt("rev", after)
          .order("rev", { ascending: true })
          .limit(50);
        if (error) throw error;
        const rows = (data ?? []) as RemoteRow[];
        if (!rows.length) break;
        await applyRemote(async () => {
          for (const r of rows) await applyRow(r);
        });
        after = rows[rows.length - 1].rev!;
        maxRev = Math.max(maxRev, after);
        if (rows.length < 50) break;
      }
      await db.syncState.put({ key, value: maxRev });
      for (const id of [...staleModels]) {
        staleModels.delete(id);
        await downloadModel(id).catch(() => {});
      }
      status({ phase: "idle", lastSync: Date.now(), message: "" });
    } catch (e) {
      status({ phase: "error", message: explain(e) });
    } finally {
      pulling = null;
    }
  })();
  return pulling;
}

// ------------------------------------------------------- files on demand ----

async function downloadModel(paperId: string): Promise<boolean> {
  if (!client || !session) return false;
  const stamp = (await db.syncState.get(`model:${paperId}`))?.value as ModelStamp | undefined;
  if (!stamp) return false;
  const { data, error } = await client.storage.from(BUCKET).download(pathOf(paperId, stamp.gz ? "model.json.gz" : "model.json"));
  if (error || !data) return false;
  const model = JSON.parse(await gunzip(data)) as DocModel;
  await applyRemote(async () => {
    await db.models.put({ paperId, model, at: stamp.at });
  });
  return true;
}

async function downloadFile(paperId: string): Promise<boolean> {
  if (!client || !session) return false;
  const { data, error } = await client.storage.from(BUCKET).download(pathOf(paperId, "paper.pdf"));
  if (error || !data) return false;
  const blob = new Blob([await data.arrayBuffer()], { type: "application/pdf" });
  await applyRemote(async () => {
    await db.files.put({ paperId, blob });
  });
  return true;
}

const ensuring = new Map<string, Promise<void>>();
/** Makes sure a synced paper's PDF and layout model are on this device. */
export function ensurePaperLocal(paperId: string): Promise<void> {
  if (!client || !session) return Promise.resolve();
  let p = ensuring.get(paperId);
  if (!p) {
    p = (async () => {
      const [f, m] = await Promise.all([db.files.get(paperId), db.models.get(paperId)]);
      if (!m) await downloadModel(paperId).catch(() => false);
      if (!f) await downloadFile(paperId).catch(() => false);
    })().finally(() => ensuring.delete(paperId));
    ensuring.set(paperId, p);
  }
  return p;
}

/** Downloads PDFs of the most recent papers so they open offline. */
export async function prefetchPapers(limit = 20, onProgress?: (done: number, total: number) => void) {
  if (!client || !session) return;
  const papers = (await db.papers.filter((p) => p.hasFile && !p.deleted).toArray())
    .sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt))
    .slice(0, limit);
  const missing: string[] = [];
  for (const p of papers) if (!(await db.files.get(p.id))) missing.push(p.id);
  let done = 0;
  for (const id of missing) {
    if (!navigator.onLine) break;
    await ensurePaperLocal(id);
    onProgress?.(++done, missing.length);
  }
}

// ------------------------------------------------------------ lifecycle ----

async function enqueueEverything() {
  const now = Date.now();
  const entries: OutboxRec[] = [];
  for (const [name, spec] of Object.entries(ROWS)) {
    const all = (await db.table(name).toArray()) as AnyRec[];
    for (const r of all) entries.push({ key: `${name}:${spec.key(r)}`, tbl: name, id: spec.key(r), at: now });
  }
  const papers = await db.papers.toArray();
  for (const p of papers) {
    if (p.deleted) continue;
    entries.push({ key: `gen:${p.id}`, tbl: "gen", id: p.id, at: now });
    if (await db.models.get(p.id)) entries.push({ key: `model:${p.id}`, tbl: "model", id: p.id, at: now });
    if (await db.files.get(p.id)) entries.push({ key: `file:${p.id}`, tbl: "file", id: p.id, at: now });
  }
  await db.outbox.bulkPut(entries);
}

async function onSignedIn(s: Session) {
  session = s;
  status({ email: s.user.email ?? null, phase: "idle" });
  const flag = `fullPush:${s.user.id}`;
  await pull();
  if (!(await db.syncState.get(flag))) {
    await enqueueEverything();
    await db.syncState.put({ key: flag, value: Date.now() });
  }
  await push();
  channel?.unsubscribe();
  channel = client!
    .channel(`ps-${s.user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "ps_records", filter: `user_id=eq.${s.user.id}` }, () => schedulePull())
    .subscribe();
  if (timer) clearInterval(timer);
  timer = setInterval(() => void pull().then(() => push()), 90_000);
  void prefetchPapers(20);
}

function onSignedOut() {
  session = null;
  channel?.unsubscribe();
  channel = null;
  if (timer) clearInterval(timer);
  timer = null;
  status({ email: null, phase: "signedOut", message: "" });
}

let pullTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePull() {
  clearTimeout(pullTimer);
  pullTimer = setTimeout(() => void pull(), 1200);
}

let started: Promise<void> | null = null;
/**
 * Starts sync when the server has a Supabase project configured. Resolves after
 * the first pull (or 12 s at most) so background jobs don't redo work another
 * device already did.
 */
export function startSync(cfg: SyncConfig | null): Promise<void> {
  if (cfg) {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    } catch {
      /* ignore */
    }
  }
  const use = cfg ?? readCfg();
  if (!use) {
    status({ configured: false, phase: "off" });
    return Promise.resolve();
  }
  recording = true;
  installHooks();
  if (started) return started;
  started = (async () => {
    status({ configured: true, phase: "signedOut", pending: await db.outbox.count() });
    const { createClient } = await import("@supabase/supabase-js");
    client = createClient(use.url, use.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "ps-auth" } });
    const { data } = await client.auth.getSession();
    client.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT") onSignedOut();
      else if (event === "SIGNED_IN" && s && s.user.id !== session?.user.id) void onSignedIn(s);
      else if (s) session = s;
    });
    if (data.session) {
      const first = onSignedIn(data.session);
      await Promise.race([first, new Promise((r) => setTimeout(r, 12_000))]);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => void pull().then(() => push()));
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void pull().then(() => push());
        else void push();
      });
    }
  })();
  return started;
}

// When sync is configured on this device, capture edits from the very first
// write (even before the passcode check or sign-in).
if (typeof window !== "undefined" && readCfg()) {
  recording = true;
  installHooks();
}

export function syncReady() {
  return !!client && !!session;
}

export async function signIn(email: string, password: string) {
  if (!client) throw new Error("同步尚未設定");
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === "Invalid login credentials" ? "Email 或密碼不正確" : error.message);
}

export async function signUp(email: string, password: string): Promise<"signedIn" | "confirm"> {
  if (!client) throw new Error("同步尚未設定");
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return data.session ? "signedIn" : "confirm";
}

export async function signOut() {
  await client?.auth.signOut();
}

export async function syncNow() {
  await pull();
  await push();
}
