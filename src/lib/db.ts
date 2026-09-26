// Local-first storage (IndexedDB via Dexie). Every user-authored record has
// `updatedAt` and a `deleted` tombstone; src/lib/sync.ts mirrors the tables to
// Supabase when cross-device sync is enabled.
import Dexie, { type Table } from "dexie";
import type { Overview, QuizQuestion, RelatedItem, WorkMeta } from "./apiTypes";
import type { Category, ColorScheme, Journal } from "./defaults";
import type { DocModel, Rect, SentRange, Side } from "@/engine/types";

export interface Author {
  display: string;
  family: string;
  given?: string;
}

export interface Paper {
  id: string;
  title: string;
  titleZh?: string;
  authors: Author[];
  year?: number;
  journal?: string;
  issn?: string[];
  volume?: string;
  issue?: string;
  firstPage?: string;
  lastPage?: string;
  doi?: string;
  openalexId?: string;
  abstract?: string;
  oaPdf?: string;
  landing?: string;
  addedAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  rating: number;
  note: string;
  tags: string[];
  folderId?: string | null;
  hasFile: boolean;
  fileName?: string;
  fileSize?: number;
  pageCount?: number;
  pageOffset?: number | null; // manual override: printed page = index + offset
  detectedPageOffset?: number | null;
  metaDone?: boolean;
  metaV?: number; // lookup strategy version
  hash?: string;
  deleted?: boolean;
}

export interface FileRec {
  paperId: string;
  blob: Blob;
}
export interface ModelRec {
  paperId: string;
  model: DocModel;
  at?: number; // when this model was produced (sync uses it to spot re-parses)
}
export interface TransRec {
  paperId: string;
  sid: string;
  page: number;
  t: string;
  c: string | null;
  mock?: boolean;
}
export interface PageStatus {
  paperId: string;
  page: number;
  done: boolean;
  at: number;
  error?: string;
}
export interface OverviewRec {
  paperId: string;
  data: Overview;
  at: number;
  detail?: string;
}

export type HighlightStyle = "highlight" | "comment";
export interface Highlight {
  id: string;
  paperId: string;
  side: Side; // the side it was drawn on (precise there, whole sentence on the other side)
  ranges: SentRange[];
  color: string; // key from HIGHLIGHT_COLORS
  style: HighlightStyle;
  note: string;
  text: string;
  page: number;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface Explanation {
  id: string;
  paperId: string;
  kind: "text" | "figure" | "model";
  side?: Side;
  ranges?: SentRange[];
  page: number;
  rect?: Rect;
  thumb?: string;
  query: string;
  answer: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

export interface NoteRec {
  paperId: string;
  text: string;
  updatedAt: number;
}
export interface ChatMsg {
  id: string;
  paperId: string;
  role: "user" | "model";
  text: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}
export interface RelatedRec {
  paperId: string;
  forYou: RelatedItem[];
  trending: RelatedItem[];
  at: number;
  note?: string;
}
export interface RefsRec {
  paperId: string;
  references: WorkMeta[];
  citedBy: WorkMeta[];
  at: number;
  note?: string;
}
export interface QuizRec {
  paperId: string;
  questions: QuizQuestion[];
  answers: (number | null)[];
  at: number;
}
export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}
export interface SavedRec {
  id: string; // openalex id or doi
  meta: RelatedItem | WorkMeta;
  savedAt: number;
  updatedAt: number;
  paperId?: string;
  deleted?: boolean;
}
export type JobStage = "queued" | "parsing" | "meta" | "overview" | "translating" | "related" | "onepager" | "paused" | "done" | "error";
export interface JobRec {
  paperId: string;
  stage: JobStage;
  pagesDone: number;
  pagesTotal: number;
  error?: string;
  note?: string; // live status, e.g. "限速中，20 秒後繼續"
  pausedUntil?: number; // daily quota exhausted: resume after this time
  updatedAt: number;
}

/** Auto-highlight category per sentence (from the whole-paper guide pass). */
export interface AutoHl {
  paperId: string;
  sid: string;
  c: string;
}

export interface OnePager {
  paperId: string;
  md: string;
  model?: string;
  at: number;
}

/**
 * One handwriting stroke (Apple Pencil, finger or mouse). Points are in PDF
 * page units at scale 1 (the same space as sentence rects), so strokes stay
 * put at any zoom. Drawn precisely on `side`; mirrored faintly on the other.
 */
export interface InkStroke {
  id: string;
  paperId: string;
  page: number;
  side: Side;
  tool: "pen" | "marker";
  color: string; // hex
  size: number; // page units
  pts: number[]; // flat [x, y, pressure, x, y, pressure, …]
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}

/** Pending local change waiting to be pushed to the cloud. */
export interface OutboxRec {
  key: string; // `${tbl}:${id}`
  tbl: string;
  id: string;
  at: number;
}
export interface SyncStateRec {
  key: string;
  value: unknown;
}

// Writing studio
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
}
export interface WritingDoc {
  id: string;
  projectId: string;
  title: string;
  order: number;
  content: unknown; // editor JSON
  updatedAt: number;
  createdAt: number;
  deleted?: boolean;
}

export interface AppSettings {
  targetLanguage: string;
  rolePrompt: string;
  researchContext: string;
  scholarQueries: string[];
  categories: Category[];
  autoHighlight: boolean;
  colorScheme: ColorScheme;
  journals: Journal[];
  onlyWhitelist: boolean;
  modelTranslate: string;
  modelChat: string;
  hoverStyle: "gray" | "green" | "amber";
  highlightDensity: "low" | "normal" | "high";
  autoOnepager: boolean;
  autoTranslate: boolean;
  theme: "system" | "light" | "dark";
  concurrency: number;
}
export interface SettingRec {
  key: string;
  value: AppSettings;
  updatedAt: number;
}

class PaperDB extends Dexie {
  papers!: Table<Paper, string>;
  files!: Table<FileRec, string>;
  models!: Table<ModelRec, string>;
  translations!: Table<TransRec, [string, string]>;
  pageStatus!: Table<PageStatus, [string, number]>;
  overviews!: Table<OverviewRec, string>;
  highlights!: Table<Highlight, string>;
  explanations!: Table<Explanation, string>;
  notes!: Table<NoteRec, string>;
  chats!: Table<ChatMsg, string>;
  related!: Table<RelatedRec, string>;
  refs!: Table<RefsRec, string>;
  quizzes!: Table<QuizRec, string>;
  folders!: Table<Folder, string>;
  saved!: Table<SavedRec, string>;
  settings!: Table<SettingRec, string>;
  jobs!: Table<JobRec, string>;
  autohl!: Table<AutoHl, [string, string]>;
  onepagers!: Table<OnePager, string>;
  projects!: Table<Project, string>;
  docs!: Table<WritingDoc, string>;
  ink!: Table<InkStroke, string>;
  outbox!: Table<OutboxRec, string>;
  syncState!: Table<SyncStateRec, string>;

  constructor() {
    super("paper-sunshine");
    this.version(1).stores({
      papers: "id, addedAt, lastOpenedAt, doi, folderId, updatedAt, hash",
      files: "paperId",
      models: "paperId",
      translations: "[paperId+sid], paperId, [paperId+page]",
      pageStatus: "[paperId+page], paperId",
      overviews: "paperId",
      highlights: "id, paperId, updatedAt",
      explanations: "id, paperId, updatedAt",
      notes: "paperId",
      chats: "id, paperId, createdAt",
      related: "paperId",
      refs: "paperId",
      quizzes: "paperId",
      folders: "id, updatedAt",
      saved: "id, savedAt",
      settings: "key",
      jobs: "paperId",
    });
    this.version(2).stores({
      autohl: "[paperId+sid], paperId",
      onepagers: "paperId",
      projects: "id, updatedAt",
      docs: "id, projectId, updatedAt",
    });
    this.version(3).stores({
      ink: "id, paperId, [paperId+page], updatedAt",
      outbox: "key, at",
      syncState: "key",
    });
  }
}

export const db = new PaperDB();

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Deletes a paper everywhere: the paper row stays as a tombstone (so other
 * devices learn about the deletion when syncing) and everything else is purged.
 */
export async function deletePaper(id: string) {
  const now = Date.now();
  await db.papers.update(id, { deleted: true, updatedAt: now, hasFile: false });
  await purgePaperData(id);
}

/** Removes a paper's local data (PDF, model, translations, notes…), keeping the paper row. */
export async function purgePaperData(id: string) {
  const tables = [
    db.files, db.models, db.translations, db.pageStatus, db.overviews, db.highlights, db.explanations, db.notes, db.chats,
    db.related, db.refs, db.quizzes, db.jobs, db.autohl, db.onepagers, db.ink,
  ];
  await db.transaction("rw", tables, async () => {
    await db.files.delete(id);
    await db.models.delete(id);
    await db.translations.where("paperId").equals(id).delete();
    await db.pageStatus.where("paperId").equals(id).delete();
    await db.overviews.delete(id);
    await db.highlights.where("paperId").equals(id).delete();
    await db.explanations.where("paperId").equals(id).delete();
    await db.notes.delete(id);
    await db.chats.where("paperId").equals(id).delete();
    await db.related.delete(id);
    await db.refs.delete(id);
    await db.quizzes.delete(id);
    await db.jobs.delete(id);
    await db.autohl.where("paperId").equals(id).delete();
    await db.onepagers.delete(id);
    await db.ink.where("paperId").equals(id).delete();
  });
}

/** Clears machine-generated data so a paper can be re-translated. */
export async function resetTranslations(id: string, opts: { model?: boolean } = {}) {
  // A new epoch tells other devices to replace (not merge) this paper's translations.
  await db.syncState.put({ key: `epoch:${id}`, value: Date.now() });
  await db.transaction("rw", [db.translations, db.pageStatus, db.overviews, db.jobs, db.autohl, db.onepagers, db.models], async () => {
    await db.translations.where("paperId").equals(id).delete();
    await db.pageStatus.where("paperId").equals(id).delete();
    await db.overviews.delete(id);
    await db.jobs.delete(id);
    await db.autohl.where("paperId").equals(id).delete();
    await db.onepagers.delete(id);
    if (opts.model) await db.models.delete(id);
  });
}
