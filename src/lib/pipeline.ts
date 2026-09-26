"use client";
// Background processing: parse → metadata → overview/glossary → per-page
// translation + auto highlight → related papers. Every step is checkpointed in
// IndexedDB, so closing the tab and reopening resumes where it stopped.
// Pages nearest to the one you are reading are translated first.
import { extractDocModel, type PdfDoc } from "@/engine/extract";
import type { Block, DocModel } from "@/engine/types";
import { ApiError, aiJson, postJson } from "./api";
import type { Overview, RelatedItem, TranslateBlock, TranslateResponse, WorkMeta } from "./apiTypes";
import { type AppSettings, type JobStage, type Paper, db, uid } from "./db";
import { openPdf } from "./pdf";
import { getSettings } from "./settings";

let focus: { paperId: string; page: number } | null = null;
export function setFocus(paperId: string, page: number) {
  focus = { paperId, page };
}

const queue: string[] = [];
const running = new Set<string>();
let looping = false;

export function enqueue(paperId: string, priority = false) {
  if (priority) {
    if (!running.has(paperId)) void runOne(paperId);
    return;
  }
  if (!queue.includes(paperId) && !running.has(paperId)) queue.push(paperId);
  void loop();
}

async function loop() {
  if (looping) return;
  looping = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      if (running.has(id)) continue;
      await runOne(id);
    }
  } finally {
    looping = false;
  }
}

export async function resumeAll() {
  const papers = await db.papers.filter((p) => p.hasFile && !p.deleted).toArray();
  for (const p of papers) {
    const job = await db.jobs.get(p.id);
    if (!job || (job.stage !== "done" && job.stage !== "error")) enqueue(p.id);
  }
}

async function setJob(paperId: string, stage: JobStage, patch: Partial<{ pagesDone: number; pagesTotal: number; error?: string }> = {}) {
  const cur = await db.jobs.get(paperId);
  await db.jobs.put({
    paperId,
    stage,
    pagesDone: patch.pagesDone ?? cur?.pagesDone ?? 0,
    pagesTotal: patch.pagesTotal ?? cur?.pagesTotal ?? 0,
    error: patch.error,
    updatedAt: Date.now(),
  });
}

async function runOne(paperId: string) {
  running.add(paperId);
  try {
    await process(paperId);
  } catch (e) {
    await setJob(paperId, "error", { error: e instanceof Error ? e.message : String(e) });
  } finally {
    running.delete(paperId);
  }
}

// ------------------------------------------------------------- import ----

async function sha1(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Imports a PDF, merging into a DOI placeholder when one exists. Returns the paper id. */
export async function importPdf(file: Blob, fileName: string, opts: { meta?: WorkMeta; folderId?: string | null } = {}): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await sha1(buf);
  const dup = await db.papers.where("hash").equals(hash).first();
  if (dup && !dup.deleted) return dup.id;

  const pdf = await openPdf(buf.slice(0));
  const model = await extractDocModel(pdf as unknown as PdfDoc);
  await pdf.loadingTask.destroy();

  const doi = (opts.meta?.doi ?? model.info.doi)?.toLowerCase();
  let target: Paper | undefined;
  if (doi) target = await db.papers.where("doi").equals(doi).filter((p) => !p.hasFile && !p.deleted).first();
  const now = Date.now();
  const id = target?.id ?? uid();
  const base: Paper = target ?? {
    id,
    title: opts.meta?.title ?? model.info.title ?? model.info.pdfTitle ?? fileName.replace(/\.pdf$/i, ""),
    authors: opts.meta?.authors ?? [],
    addedAt: now,
    updatedAt: now,
    rating: 0,
    note: "",
    tags: [],
    folderId: opts.folderId ?? null,
    hasFile: true,
  };
  const paper: Paper = {
    ...base,
    ...(opts.meta ? metaPatch(opts.meta) : {}),
    doi: doi ?? base.doi,
    hasFile: true,
    fileName,
    fileSize: file.size,
    pageCount: model.pages.length,
    detectedPageOffset: model.info.pageOffset,
    hash,
    updatedAt: now,
    metaDone: opts.meta ? true : base.metaDone,
  };
  await db.transaction("rw", [db.papers, db.files, db.models], async () => {
    await db.papers.put(paper);
    await db.files.put({ paperId: id, blob: new Blob([buf], { type: "application/pdf" }) });
    await db.models.put({ paperId: id, model });
  });
  if (doi) {
    const saved = await db.saved.filter((s) => s.meta.doi?.toLowerCase() === doi).first();
    if (saved) await db.saved.update(saved.id, { paperId: id, updatedAt: now });
  }
  enqueue(id);
  return id;
}

export function metaPatch(w: WorkMeta): Partial<Paper> {
  return {
    title: w.title,
    authors: w.authors,
    year: w.year,
    journal: w.journal,
    issn: w.issn,
    volume: w.volume,
    issue: w.issue,
    firstPage: w.firstPage,
    lastPage: w.lastPage,
    doi: w.doi,
    openalexId: w.openalexId,
    abstract: w.abstract,
    oaPdf: w.oaPdf,
    landing: w.landing,
  };
}

/** Adds a paper by DOI without a PDF (you download it via VPN and drop it in later). */
export async function addByDoi(doiInput: string): Promise<string> {
  const doi = doiInput.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();
  const existing = await db.papers.where("doi").equals(doi).first();
  if (existing && !existing.deleted) return existing.id;
  const { work } = await postJson<{ work: WorkMeta | null }>("/api/scholar/lookup", { doi });
  const now = Date.now();
  const id = uid();
  await db.papers.put({
    id,
    title: work?.title ?? doi,
    authors: work?.authors ?? [],
    addedAt: now,
    updatedAt: now,
    rating: 0,
    note: "",
    tags: [],
    folderId: null,
    hasFile: false,
    metaDone: !!work,
    ...(work ? metaPatch(work) : {}),
    doi,
  });
  return id;
}

// ------------------------------------------------------------ process ----

async function process(paperId: string) {
  let paper = await db.papers.get(paperId);
  if (!paper || !paper.hasFile || paper.deleted) return;
  const settings = await getSettings();
  await setJob(paperId, "parsing");

  let model = (await db.models.get(paperId))?.model;
  if (!model) {
    const f = await db.files.get(paperId);
    if (!f) throw new Error("找不到 PDF 檔案");
    const pdf = await openPdf(await f.blob.arrayBuffer());
    model = await extractDocModel(pdf as unknown as PdfDoc);
    await pdf.loadingTask.destroy();
    await db.models.put({ paperId, model });
    await db.papers.update(paperId, { pageCount: model.pages.length, detectedPageOffset: model.info.pageOffset, doi: paper.doi ?? model.info.doi });
    paper = (await db.papers.get(paperId))!;
  }

  if (!paper.metaDone) {
    await setJob(paperId, "meta");
    try {
      const { work } = await postJson<{ work: WorkMeta | null }>("/api/scholar/lookup", {
        doi: paper.doi ?? model.info.doi,
        title: model.info.title ?? model.info.pdfTitle ?? paper.title,
      });
      const patch: Partial<Paper> = work ? metaPatch(work) : {};
      if (!work && model.info.title && paper.title === paper.fileName?.replace(/\.pdf$/i, "")) patch.title = model.info.title;
      await db.papers.update(paperId, { ...patch, metaDone: true, updatedAt: Date.now() });
      paper = (await db.papers.get(paperId))!;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) throw e;
      await db.papers.update(paperId, { metaDone: true });
    }
  }

  if (settings.autoTranslate) {
    let overview = (await db.overviews.get(paperId))?.data;
    if (!overview) {
      await setJob(paperId, "overview");
      overview = await aiJson<Overview>({
        task: "overview",
        title: paper.title,
        text: overviewText(model),
        rolePrompt: settings.rolePrompt,
        targetLanguage: settings.targetLanguage,
        model: settings.modelTranslate || undefined,
      });
      await db.overviews.put({ paperId, data: overview, at: Date.now() });
      if (overview.titleZh) await db.papers.update(paperId, { titleZh: overview.titleZh });
    }
    await translateAll(paperId, model, overview, settings, paper.title);
  }

  if (paper.metaDone && !(await db.related.get(paperId))) {
    await setJob(paperId, "related");
    try {
      await refreshRelated(paperId, "forYou");
    } catch {
      /* related papers are optional */
    }
  }
  const job = await db.jobs.get(paperId);
  if (job?.stage !== "error") await setJob(paperId, "done");
}

function overviewText(model: DocModel): string {
  const parts: string[] = [];
  let len = 0;
  for (const sid of model.order) {
    const s = model.sentences[sid];
    const t = s.kind === "heading" ? `\n## ${s.text}\n` : s.text;
    parts.push(t);
    len += t.length + 1;
    if (len > 45000) break;
  }
  return parts.join(" ");
}

/** Glossary terms get the "English（中文）" form only in their first sentence. */
function firstTerms(model: DocModel, glossary: { en: string; zh: string }[]) {
  const out = new Map<string, { en: string; zh: string }[]>();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const g of glossary) {
    const variants = g.en
      .split(/,\s*|\s*\(|\)/)
      .map((v) => v.trim())
      .filter((v) => v.length >= 2)
      .sort((a, b) => b.length - a.length);
    if (!variants.length) continue;
    const re = new RegExp(`(^|[^A-Za-z])(${variants.map(esc).join("|")})([^A-Za-z]|$)`, "i");
    for (const sid of model.order) {
      const s = model.sentences[sid];
      if (s.kind === "label") continue;
      if (re.test(s.text)) {
        const list = out.get(sid) ?? [];
        list.push(g);
        out.set(sid, list);
        break;
      }
    }
  }
  return out;
}

function pageRequestBlocks(model: DocModel, page: number, first: Map<string, { en: string; zh: string }[]>): TranslateBlock[][] {
  const blocks = model.pages[page].blocks.filter((b: Block) => b.kind !== "skip" && b.sids.length);
  const chunks: TranslateBlock[][] = [];
  let cur: TranslateBlock[] = [];
  let len = 0;
  for (const b of blocks) {
    const sentences = b.sids.map((sid) => {
      const s = model.sentences[sid];
      const ft = first.get(sid);
      return { id: sid, text: s.text.replace(/\s+/g, " "), ...(ft ? { first_terms: ft } : {}) };
    });
    const blen = sentences.reduce((a, s) => a + s.text.length, 0);
    if (len + blen > 9000 && cur.length) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    cur.push({ kind: b.kind as TranslateBlock["kind"], sentences });
    len += blen;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function translateAll(paperId: string, model: DocModel, overview: Overview, settings: AppSettings, title: string) {
  const first = firstTerms(model, overview.glossary);
  const pages = model.pages.map((p) => p.i).filter((i) => model.pages[i].blocks.some((b) => b.kind !== "skip" && b.sids.length));
  const doneRecs = await db.pageStatus.where("paperId").equals(paperId).toArray();
  const done = new Set(doneRecs.filter((r) => r.done).map((r) => r.page));
  const pending = pages.filter((p) => !done.has(p));
  await setJob(paperId, "translating", { pagesDone: pages.length - pending.length, pagesTotal: pages.length });
  if (!pending.length) return;

  let failed = 0;
  let lastError = "";
  const next = () => {
    if (!pending.length) return undefined;
    const f = focus?.paperId === paperId ? focus.page : 0;
    pending.sort((a, b) => Math.abs(a - f) - Math.abs(b - f) || a - b);
    return pending.shift();
  };
  const worker = async () => {
    for (let page = next(); page !== undefined; page = next()) {
      try {
        await translatePage(paperId, model, page, first, overview, settings, title);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) throw e;
        failed++;
        lastError = e instanceof Error ? e.message : String(e);
        await db.pageStatus.put({ paperId, page, done: false, at: Date.now(), error: lastError });
      }
      const count = await db.pageStatus.where("paperId").equals(paperId).filter((r) => r.done).count();
      await setJob(paperId, "translating", { pagesDone: count, pagesTotal: pages.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(6, settings.concurrency)) }, worker));
  if (failed) await setJob(paperId, "error", { error: `${failed} 頁翻譯失敗：${lastError}` });
}

async function translatePage(
  paperId: string,
  model: DocModel,
  page: number,
  first: Map<string, { en: string; zh: string }[]>,
  overview: Overview,
  settings: AppSettings,
  title: string,
) {
  const chunks = pageRequestBlocks(model, page, first);
  const pageText = chunks
    .flat()
    .flatMap((b) => b.sentences.map((s) => s.text))
    .join(" ")
    .toLowerCase();
  const glossary = overview.glossary.filter((g) => g.en.split(/,\s*|\s*\(|\)/).some((v) => v.trim().length >= 2 && pageText.includes(v.trim().toLowerCase())));
  for (const blocks of chunks) {
    const call = (bl: TranslateBlock[]) =>
      withRetry(() =>
        aiJson<TranslateResponse>({
          task: "translate",
          paperTitle: title,
          blocks: bl,
          glossary,
          rolePrompt: settings.rolePrompt,
          targetLanguage: settings.targetLanguage,
          categories: settings.categories,
          autoHighlight: settings.autoHighlight,
          model: settings.modelTranslate || undefined,
        }),
      );
    const res = await call(blocks);
    const got = new Map(res.items.map((i) => [i.id, i]));
    const missing = blocks.map((b) => ({ ...b, sentences: b.sentences.filter((s) => !got.has(s.id)) })).filter((b) => b.sentences.length);
    if (missing.length) {
      try {
        const res2 = await call(missing);
        for (const i of res2.items) got.set(i.id, i);
      } catch {
        /* keep partial result */
      }
    }
    const recs = blocks.flatMap((b) =>
      b.sentences.map((s) => {
        const it = got.get(s.id);
        return { paperId, sid: s.id, page, t: it?.t ?? "", c: it?.c ?? null, mock: res.mock || undefined };
      }),
    );
    await db.translations.bulkPut(recs);
  }
  await db.pageStatus.put({ paperId, page, done: true, at: Date.now() });
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e instanceof ApiError && (e.status === 401 || e.status === 400)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1) ** 2));
    }
  }
  throw last;
}

// ------------------------------------------------------------ related ----

export async function refreshRelated(paperId: string, mode: "forYou" | "trending") {
  const paper = await db.papers.get(paperId);
  if (!paper) return;
  const settings = await getSettings();
  const overview = (await db.overviews.get(paperId))?.data;
  const library = await db.papers.filter((p) => !!p.doi && !p.deleted).toArray();
  const res = await postJson<{ items: RelatedItem[]; note?: string; error?: string }>("/api/scholar/related", {
    mode,
    openalexId: paper.openalexId,
    doi: paper.doi,
    title: paper.title,
    abstract: paper.abstract,
    keywords: overview?.keywords.map((k) => k.en) ?? [],
    queries: settings.scholarQueries,
    researchContext: settings.researchContext,
    journals: settings.journals,
    onlyWhitelist: settings.onlyWhitelist,
    exclude: library.map((p) => p.doi!),
  });
  const cur = (await db.related.get(paperId)) ?? { paperId, forYou: [], trending: [], at: 0 };
  await db.related.put({ ...cur, [mode]: res.items, at: Date.now(), note: res.note ?? res.error });
}
