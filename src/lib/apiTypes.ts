// Request/response shapes shared by the client and the API routes.
import type { Category } from "./defaults";

export interface TranslateSentence {
  id: string;
  text: string;
  first_terms?: { en: string; zh: string }[];
}
export interface TranslateBlock {
  kind: "para" | "heading" | "caption" | "label";
  sentences: TranslateSentence[];
}
export interface TranslateRequest {
  task: "translate";
  paperTitle?: string;
  blocks: TranslateBlock[];
  glossary: { en: string; zh: string }[];
  rolePrompt: string;
  targetLanguage: string;
  categories: Category[];
  autoHighlight: boolean;
  model?: string;
}
export interface TranslateItem {
  id: string;
  t: string;
  c: string | null;
}
export interface TranslateResponse {
  items: TranslateItem[];
  mock?: boolean;
  model?: string;
}

export interface OverviewRequest {
  task: "overview";
  title?: string;
  text: string;
  rolePrompt: string;
  targetLanguage: string;
  model?: string;
}
export interface Overview {
  titleZh: string;
  summary3: string[];
  keywords: { en: string; zh: string; def: string }[];
  glossary: { en: string; zh: string }[];
  mock?: boolean;
}

export interface QuizRequest {
  task: "quiz";
  title?: string;
  text: string;
  targetLanguage: string;
  model?: string;
}
export interface QuizQuestion {
  q: string;
  qEn: string;
  options: string[];
  answer: number;
  explain: string;
}

export interface RerankRequest {
  task: "rerank";
  paper: { title: string; abstract?: string; keywords?: string[] };
  researchContext: string;
  candidates: { id: string; title: string; abstract?: string; venue?: string; year?: number }[];
  model?: string;
}
export interface RerankItem {
  id: string;
  score: number;
  reason: string;
}

/** One request per paper: reading guide + glossary + every auto highlight. */
export interface GuideRequest {
  task: "guide";
  title?: string;
  lines: string; // "## heading" or "<sid>\t<sentence>" per line, whole paper
  rolePrompt: string;
  targetLanguage: string;
  categories: Category[];
  autoHighlight: boolean;
  model?: string;
}
export interface Guide extends Overview {
  highlights: { id: string; c: string }[];
}

/** Streamed translation of several pages at once; output is "<sid>\t<translation>" lines. */
export interface TranslateLinesRequest {
  paperTitle?: string;
  blocks: TranslateBlock[];
  glossary: { en: string; zh: string }[];
  rolePrompt: string;
  targetLanguage: string;
  model?: string;
}

export type JsonTaskRequest = TranslateRequest | OverviewRequest | GuideRequest | QuizRequest | RerankRequest;

export interface StreamRequest {
  task: "explain" | "figure" | "model" | "chat" | "summary" | "onepager";
  targetLanguage: string;
  paperTitle?: string;
  paperText?: string; // full text (chat / summary)
  overview?: string; // short summary + keywords
  researchContext?: string;
  selection?: string; // selected text (explain)
  context?: string; // surrounding paragraph (explain)
  side?: "src" | "tgt";
  image?: string; // base64 PNG without prefix (figure / model)
  caption?: string;
  messages?: { role: "user" | "model"; text: string }[];
  model?: string;
}

export interface WorkMeta {
  openalexId?: string;
  doi?: string;
  title: string;
  authors: { display: string; family: string; given?: string }[];
  year?: number;
  journal?: string;
  issn?: string[];
  volume?: string;
  issue?: string;
  firstPage?: string;
  lastPage?: string;
  citedBy?: number;
  oaPdf?: string;
  oaUrl?: string;
  landing?: string;
  abstract?: string;
  type?: string;
}

export interface RelatedItem extends WorkMeta {
  score: number;
  reason: string;
  sources: string[]; // why it was a candidate: cites | cited | related | search
  tier?: number;
}

export interface HealthResponse {
  ok: boolean;
  passcodeRequired: boolean;
  authorized: boolean;
  gemini: boolean;
  openalex: boolean;
  providers: Record<string, boolean>;
  models: { translate: string; chat: string };
  version: string;
}
