"use client";
// Background processing: parse → metadata → guide pass (reading guide,
// glossary, all auto highlights) → streamed multi-page translation → related
// papers → one-page summary. Every step is checkpointed in IndexedDB, so
// closing the tab and reopening resumes where it stopped; daily quota limits
// pause the job until the quota resets.
import { extractDocModel, type PdfDoc } from "@/engine/extract";
import { citationHints } from "@/engine/hints";
import { ENGINE_VERSION } from "@/engine/layout";
import type { Block, DocModel } from "@/engine/types";
import { ApiError, aiJson, aiStream, friendlyError, postJson, streamLines } from "./api";
import type { Guide, Overview, RelatedItem, TranslateBlock, WorkMeta } from "./apiTypes";
import { type AppSettings, type JobStage, type Paper, type TransRec, db, resetTranslations, uid } from "./db";
import { openPdf } from "./pdf";
import { getSettings, models } from "./settings";

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
    if (job?.stage === "paused" && job.pausedUntil && job.pausedUntil > Date.now()) continue;
    if (!job || (job.stage !== "done" && job.stage !== "error")) enqueue(p.id);
  }
}

/** Clears a daily-quota pause (e.g. after switching models) and restarts the job. */
export async function unpause(paperId: string) {
  await db.jobs.update(paperId, { stage: "queued", pausedUntil: undefined, note: "" });
  enqueue(paperId, true);
}

async function setJob(
  paperId: string,
  stage: JobStage,
  patch: Partial<{ pagesDone: number; pagesTotal: number; error?: string; note?: string; pausedUntil?: number }> = {},
) {
  const cur = await db.jobs.get(paperId);
  await db.jobs.put({
    paperId,
    stage,
    pagesDone: patch.pagesDone ?? cur?.pagesDone ?? 0,
    pagesTotal: patch.pagesTotal ?? cur?.pagesTotal ?? 0,
    error: patch.error,
    note: patch.note ?? (stage === cur?.stage ? cur?.note : undefined),
    pausedUntil: stage === "paused" ? patch.pausedUntil : undefined,
    updatedAt: Date.now(),
  });
}

async function runOne(paperId: string) {
  running.add(paperId);
  try {
    await process(paperId);
  } catch (e) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      // Offline: park the job; AppFrame calls resumeAll() when the network returns.
      await setJob(paperId, "paused", { note: "離線中，連上網路後會自動繼續" });
    } else {
      await setJob(paperId, "error", { error: e instanceof Error ? e.message : String(e) });
    }
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
//
// Request budget per paper (free Gemini tiers allow ~20 Flash / ~500
// Flash-Lite requests a day): 1 guide pass (reading guide + glossary + every
// auto highlight) + a few streamed multi-page translation batches + 1 related
// rerank + 1 one-page summary. Roughly 6 to 8 requests for a 20-page paper.

const BATCH_CHARS = 12_000;

class QuotaPause extends Error {}

async function process(paperId: string) {
  let paper = await db.papers.get(paperId);
  if (!paper || !paper.hasFile || paper.deleted) return;
  const job0 = await db.jobs.get(paperId);
  if (job0?.stage === "paused" && job0.pausedUntil && job0.pausedUntil > Date.now()) return;
  const settings = await getSettings();
  const m = models(settings);
  await setJob(paperId, "parsing");

  let model = (await db.models.get(paperId))?.model;
  // Re-parse papers from an older engine when no annotation depends on their sentence ids.
  if (model && (model.ev ?? 1) < ENGINE_VERSION) {
    const used = (await db.highlights.where("paperId").equals(paperId).count()) + (await db.explanations.where("paperId").equals(paperId).count());
    if (!used) {
      await resetTranslations(paperId, { model: true });
      model = undefined;
    }
  }
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

  if (!paper.metaDone || ((paper.metaV ?? 1) < 2 && !paper.openalexId)) {
    await setJob(paperId, "meta");
    await lookupMeta(paperId, model);
    paper = (await db.papers.get(paperId))!;
  }

  try {
    if (settings.autoTranslate) {
      let overview = (await db.overviews.get(paperId))?.data;
      const hlCount = await db.autohl.where("paperId").equals(paperId).count();
      // Legacy per-page categories (v0.1) cover only the pages translated back then, so they don't count.
      if (!overview || (settings.autoHighlight && !hlCount)) {
        await setJob(paperId, "overview");
        overview = await withQuota(paperId, () => runGuide(paperId, model!, paper!.title, settings, m.translate));
      }
      await translateAll(paperId, model, overview, settings, paper.title, m.translate);
    }

    if (paper.metaDone && !(await db.related.get(paperId))) {
      await setJob(paperId, "related");
      try {
        await refreshRelated(paperId, "forYou");
      } catch {
        /* related papers are optional */
      }
    }

    if (settings.autoTranslate && settings.autoOnepager && !(await db.onepagers.get(paperId))) {
      await setJob(paperId, "onepager");
      try {
        await withQuota(paperId, () => generateOnePager(paperId, () => {}));
      } catch (e) {
        if (e instanceof QuotaPause) throw e;
      }
    }
  } catch (e) {
    if (e instanceof QuotaPause) return; // job already marked "paused"
    throw e;
  }
  const job = await db.jobs.get(paperId);
  if (job?.stage !== "error") await setJob(paperId, "done");
}

/** Runs fn; on per-minute limits waits and retries, on daily limits pauses the job. */
async function withQuota<T>(paperId: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        if (e.perDay || i >= tries - 1) {
          const until = nextQuotaReset();
          await setJob(paperId, "paused", { note: friendlyError(e), pausedUntil: until });
          throw new QuotaPause(e.message);
        }
        const wait = Math.min(90, e.retryAfter ?? 20 * (i + 1));
        await setJob(paperId, (await db.jobs.get(paperId))?.stage ?? "translating", { note: `請求太頻繁，${wait} 秒後自動繼續` });
        await sleep(wait * 1000);
        continue;
      }
      if (e instanceof ApiError && (e.status === 408 || e.status === 0 || e.status >= 500) && i < 2) {
        await sleep(3000 * (i + 1));
        continue;
      }
      throw e;
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gemini free quotas reset at midnight Pacific time. */
function nextQuotaReset(): number {
  const now = new Date();
  const pacific = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  const diff = now.getTime() - pacific.getTime();
  const next = new Date(pacific);
  next.setHours(24, 5, 0, 0);
  return next.getTime() + diff;
}

// ---------------------------------------------------------------- meta ----

export async function lookupMeta(paperId: string, model: DocModel, doiOverride?: string) {
  const paper = await db.papers.get(paperId);
  if (!paper) return null;
  const h = citationHints(model);
  try {
    const { work } = await postJson<{ work: WorkMeta | null }>("/api/scholar/lookup", {
      doi: doiOverride ?? paper.doi ?? h.doi,
      titles: h.titles,
      title: paper.title,
      issn: h.issn,
      year: h.year,
      volume: h.volume,
      firstPage: h.firstPage,
    });
    const patch: Partial<Paper> = work ? metaPatch(work) : {};
    if (!work && h.titles[0] && paper.title === paper.fileName?.replace(/\.pdf$/i, "")) patch.title = h.titles[0];
    await db.papers.update(paperId, { ...patch, metaDone: true, metaV: 2, updatedAt: Date.now() });
    if (work) {
      // New identity: recompute related papers and citation cards.
      await db.related.delete(paperId);
      await db.refs.delete(paperId);
    }
    return work;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) throw e;
    await db.papers.update(paperId, { metaDone: true, metaV: 2 });
    return null;
  }
}

// --------------------------------------------------------------- guide ----

/** "## heading" / "<sid>\t<sentence>" lines for whole-paper prompts. */
export function paperLines(model: DocModel, max = 180_000): string {
  const out: string[] = [];
  let len = 0;
  for (const sid of model.order) {
    const s = model.sentences[sid];
    if (s.kind === "label") continue;
    const line = s.kind === "heading" ? `## ${s.text}` : `${sid}\t${s.text.replace(/\s+/g, " ")}`;
    out.push(line);
    len += line.length + 1;
    if (len > max) break;
  }
  return out.join("\n");
}

async function runGuide(paperId: string, model: DocModel, title: string, settings: AppSettings, modelSpec: string): Promise<Overview> {
  const g = await aiJson<Guide>(
    {
      task: "guide",
      title,
      lines: paperLines(model),
      rolePrompt: settings.rolePrompt,
      targetLanguage: settings.targetLanguage,
      categories: settings.categories,
      autoHighlight: settings.autoHighlight,
      density: settings.highlightDensity,
      model: modelSpec,
    },
    undefined,
    240_000,
  );
  const overview: Overview = { titleZh: g.titleZh, summary3: g.summary3, keywords: g.keywords, glossary: g.glossary, mock: g.mock };
  await db.overviews.put({ paperId, data: overview, at: Date.now() });
  if (g.titleZh) await db.papers.update(paperId, { titleZh: g.titleZh });
  await saveAutoHighlights(paperId, model, g.highlights ?? []);
  return overview;
}

async function saveAutoHighlights(paperId: string, model: DocModel, list: { id: string; c: string }[]) {
  const valid = new Set(model.order);
  const hl = list.filter((x) => valid.has(x.id)).map((x) => ({ paperId, sid: x.id, c: x.c }));
  await db.transaction("rw", [db.autohl, db.translations], async () => {
    await db.autohl.where("paperId").equals(paperId).delete();
    if (hl.length) await db.autohl.bulkPut(hl);
    // Drop legacy per-page categories so only the whole-paper pick shows.
    await db.translations.where("paperId").equals(paperId).filter((t) => !!t.c).modify({ c: null });
  });
  return hl.length;
}

/** Re-picks the auto highlights for the whole paper (keeps translations and overview). */
export async function regenerateHighlights(paperId: string): Promise<number> {
  const [paper, rec, settings] = await Promise.all([db.papers.get(paperId), db.models.get(paperId), getSettings()]);
  if (!paper || !rec) throw new Error("論文還沒解析完成");
  const g = await aiJson<Guide>(
    {
      task: "guide",
      title: paper.title,
      lines: paperLines(rec.model),
      rolePrompt: settings.rolePrompt,
      targetLanguage: settings.targetLanguage,
      categories: settings.categories,
      autoHighlight: true,
      highlightsOnly: true,
      density: settings.highlightDensity,
      model: models(settings).translate,
    },
    undefined,
    240_000,
  );
  return saveAutoHighlights(paperId, rec.model, g.highlights ?? []);
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

function pageBlocks(model: DocModel, page: number, first: Map<string, { en: string; zh: string }[]>): TranslateBlock[] {
  return model.pages[page].blocks
    .filter((b: Block) => b.kind !== "skip" && b.sids.length)
    .map((b) => ({
      kind: b.kind as TranslateBlock["kind"],
      sentences: b.sids.map((sid) => {
        const ft = first.get(sid);
        return { id: sid, text: model.sentences[sid].text.replace(/\s+/g, " "), ...(ft ? { first_terms: ft } : {}) };
      }),
    }));
}

// ----------------------------------------------------------- translate ----

async function translateAll(paperId: string, model: DocModel, overview: Overview, settings: AppSettings, title: string, modelSpec: string) {
  const first = firstTerms(model, overview.glossary);
  const pages = model.pages.map((p) => p.i).filter((i) => model.pages[i].blocks.some((b) => b.kind !== "skip" && b.sids.length));
  const doneRecs = await db.pageStatus.where("paperId").equals(paperId).toArray();
  const done = new Set(doneRecs.filter((r) => r.done).map((r) => r.page));
  let pending = pages.filter((p) => !done.has(p));
  await setJob(paperId, "translating", { pagesDone: pages.length - pending.length, pagesTotal: pages.length, note: "" });
  if (!pending.length) return;

  // Reading order starting from the page in view, then wrap around.
  const f = focus?.paperId === paperId ? focus.page : 0;
  pending = [...pending.filter((p) => p >= f), ...pending.filter((p) => p < f)];

  // Group consecutive pages into batches of ~BATCH_CHARS.
  const batches: number[][] = [];
  let cur: number[] = [];
  let len = 0;
  for (const p of pending) {
    const plen = pageBlocks(model, p, first).reduce((a, b) => a + b.sentences.reduce((x, s) => x + s.text.length, 0), 0);
    if (cur.length && (len + plen > BATCH_CHARS || p !== cur[cur.length - 1] + 1)) {
      batches.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(p);
    len += plen;
  }
  if (cur.length) batches.push(cur);

  let failed = 0;
  let lastError = "";
  const queue = [...batches];
  const worker = async () => {
    for (let batch = queue.shift(); batch; batch = queue.shift()) {
      try {
        await withQuota(paperId, () => translateBatch(paperId, model, batch!, first, overview, settings, title, modelSpec));
      } catch (e) {
        if (e instanceof QuotaPause) throw e;
        if (e instanceof ApiError && e.status === 401) throw e;
        failed++;
        lastError = friendlyError(e);
        for (const page of batch) await db.pageStatus.put({ paperId, page, done: false, at: Date.now(), error: lastError });
      }
      const count = await db.pageStatus.where("paperId").equals(paperId).filter((r) => r.done).count();
      await setJob(paperId, "translating", { pagesDone: count, pagesTotal: pages.length, note: "" });
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.max(1, Math.min(4, settings.concurrency)) }, worker));
  const pause = results.find((r) => r.status === "rejected" && r.reason instanceof QuotaPause);
  if (pause) throw (pause as PromiseRejectedResult).reason;
  const other = results.find((r) => r.status === "rejected");
  if (other) throw (other as PromiseRejectedResult).reason;
  if (failed) await setJob(paperId, "error", { error: `${failed} 批翻譯失敗：${lastError}` });
}

async function translateBatch(
  paperId: string,
  model: DocModel,
  pages: number[],
  first: Map<string, { en: string; zh: string }[]>,
  overview: Overview,
  settings: AppSettings,
  title: string,
  modelSpec: string,
) {
  const blocks = pages.flatMap((p) => pageBlocks(model, p, first));
  const want = new Set(blocks.flatMap((b) => b.sentences.map((s) => s.id)));
  const text = blocks
    .flatMap((b) => b.sentences.map((s) => s.text))
    .join(" ")
    .toLowerCase();
  const glossary = overview.glossary.filter((g) => g.en.split(/,\s*|\s*\(|\)/).some((v) => v.trim().length >= 2 && text.includes(v.trim().toLowerCase())));
  const got = new Map<string, string>();
  let mock = false;

  const run = async (bl: TranslateBlock[]) => {
    let buffer: TransRec[] = [];
    let last = Date.now();
    const flush = async () => {
      if (!buffer.length) return;
      const recs = buffer;
      buffer = [];
      await db.translations.bulkPut(recs);
    };
    const res = await streamLines(
      { paperTitle: title, blocks: bl, glossary, rolePrompt: settings.rolePrompt, targetLanguage: settings.targetLanguage, model: modelSpec },
      (line) => {
        const m = line.match(/^\s*(\d+\.\d+)\s*(?:\t|\s\|\s|｜|:\s)\s*(.+?)\s*$/);
        if (!m || !want.has(m[1])) return;
        got.set(m[1], m[2]);
        buffer.push({ paperId, sid: m[1], page: model.sentences[m[1]].p, t: m[2], c: null });
        if (Date.now() - last > 400) {
          last = Date.now();
          void flush();
        }
      },
    );
    mock ||= res.mock;
    await flush();
  };

  await run(blocks);
  // One follow-up for anything the model skipped.
  const missing = blocks.map((b) => ({ ...b, sentences: b.sentences.filter((s) => !got.has(s.id)) })).filter((b) => b.sentences.length);
  if (missing.length && got.size) {
    try {
      await run(missing);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) throw e;
    }
  } else if (!got.size) {
    throw new ApiError("模型沒有回傳任何譯文", 502);
  }
  if (mock) await db.translations.where("paperId").equals(paperId).filter((t) => want.has(t.sid)).modify({ mock: true });
  for (const page of pages) await db.pageStatus.put({ paperId, page, done: true, at: Date.now() });
}

// ------------------------------------------------------------ one-pager ----

export async function generateOnePager(paperId: string, onText: (md: string) => void, modelSpec?: string): Promise<string> {
  const paper = await db.papers.get(paperId);
  const model = (await db.models.get(paperId))?.model;
  if (!paper || !model) throw new Error("論文尚未解析");
  const settings = await getSettings();
  const overview = (await db.overviews.get(paperId))?.data;
  const md = await aiStream(
    {
      task: "onepager",
      targetLanguage: settings.targetLanguage,
      paperTitle: paper.title,
      paperText: paperLines(model, 160_000),
      overview: overview ? `${overview.summary3.join("\n")}` : undefined,
      researchContext: settings.researchContext,
      model: modelSpec ?? models(settings).chat,
    },
    onText,
  );
  await db.onepagers.put({ paperId, md, at: Date.now(), model: modelSpec ?? models(settings).chat });
  return md;
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
    model: models(settings).translate,
  });
  const cur = (await db.related.get(paperId)) ?? { paperId, forYou: [], trending: [], at: 0 };
  await db.related.put({ ...cur, [mode]: res.items, at: Date.now(), note: res.note ?? res.error });
}
