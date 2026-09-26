// OpenAlex client. Since Feb 2026 every request needs a (free) API key;
// singleton lookups are free, list/filter calls cost 1 credit, search more.
import type { WorkMeta } from "../apiTypes";

const BASE = "https://api.openalex.org";
const SELECT =
  "id,doi,display_name,publication_year,authorships,primary_location,best_oa_location,open_access,cited_by_count,biblio,abstract_inverted_index,type,referenced_works,related_works";

export function hasOpenAlex(): boolean {
  return !!process.env.OPENALEX_API_KEY;
}

export interface OAWork {
  id: string;
  doi?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: { author?: { display_name?: string | null }; raw_author_name?: string | null }[];
  primary_location?: {
    source?: { display_name?: string | null; issn?: string[] | null; issn_l?: string | null } | null;
    landing_page_url?: string | null;
    pdf_url?: string | null;
  } | null;
  best_oa_location?: { pdf_url?: string | null; landing_page_url?: string | null } | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null } | null;
  cited_by_count?: number;
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  type?: string | null;
  referenced_works?: string[];
  related_works?: string[];
}

async function oa<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.OPENALEX_API_KEY;
  const qs = new URLSearchParams({ ...params, ...(key ? { api_key: key } : {}) });
  const res = await fetch(`${BASE}${path}?${qs}`, { headers: { "user-agent": "PaperSunshine/0.1" } });
  if (!res.ok) throw new Error(`OpenAlex ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()) as T;
}

export const shortId = (id: string) => id.replace("https://openalex.org/", "");
const cleanDoi = (doi?: string | null) => (doi ? doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase() : undefined);

function abstractOf(inv?: Record<string, number[]> | null): string | undefined {
  if (!inv) return undefined;
  const words: string[] = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  const text = words.filter(Boolean).join(" ");
  return text.length > 1500 ? `${text.slice(0, 1500)}…` : text;
}

function splitName(display: string) {
  const d = display.trim();
  if (/[一-鿿]/.test(d) && !d.includes(" ")) return { display: d, family: d.slice(0, 1), given: d.slice(1) };
  const parts = d.split(/\s+/);
  const family = parts.pop() ?? d;
  return { display: d, family, given: parts.join(" ") || undefined };
}

export function toMeta(w: OAWork): WorkMeta {
  const src = w.primary_location?.source;
  const oaPdf = w.best_oa_location?.pdf_url ?? (w.open_access?.oa_url?.toLowerCase().endsWith(".pdf") ? w.open_access.oa_url : null);
  return {
    openalexId: shortId(w.id),
    doi: cleanDoi(w.doi),
    title: w.display_name ?? "(untitled)",
    authors: (w.authorships ?? []).map((a) => splitName(a.author?.display_name ?? a.raw_author_name ?? "")).filter((a) => a.display),
    year: w.publication_year ?? undefined,
    journal: src?.display_name ?? undefined,
    issn: src?.issn ?? undefined,
    volume: w.biblio?.volume ?? undefined,
    issue: w.biblio?.issue ?? undefined,
    firstPage: w.biblio?.first_page ?? undefined,
    lastPage: w.biblio?.last_page ?? undefined,
    citedBy: w.cited_by_count,
    oaPdf: oaPdf ?? undefined,
    oaUrl: w.open_access?.oa_url ?? w.best_oa_location?.landing_page_url ?? undefined,
    landing: w.primary_location?.landing_page_url ?? (w.doi ?? undefined),
    abstract: abstractOf(w.abstract_inverted_index),
    type: w.type ?? undefined,
  };
}

export async function getWork(idOrDoi: { id?: string; doi?: string }): Promise<OAWork | null> {
  try {
    if (idOrDoi.id) return await oa<OAWork>(`/works/${shortId(idOrDoi.id)}`, { select: SELECT });
    if (idOrDoi.doi) return await oa<OAWork>(`/works/doi:${encodeURIComponent(cleanDoi(idOrDoi.doi) ?? "")}`, { select: SELECT });
  } catch (e) {
    if (String(e).includes("404")) return null;
    throw e;
  }
  return null;
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, " ").trim();
}
export function dice(a: string, b: string) {
  const bi = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const A = bi(norm(a));
  const B = bi(norm(b));
  let inter = 0;
  let total = 0;
  for (const [k, v] of A) (inter += Math.min(v, B.get(k) ?? 0)), (total += v);
  for (const v of B.values()) total += v;
  return total ? (2 * inter) / total : 0;
}

/** Exact lookup by journal ISSN + year + first page (works for PDFs without a printed DOI). */
export async function findByBiblio(b: { issn: string[]; year?: number; firstPage?: string; volume?: string }): Promise<OAWork | null> {
  if (!b.issn.length || !b.firstPage) return null;
  const filter = [
    `primary_location.source.issn:${b.issn.slice(0, 4).join("|")}`,
    b.year ? `publication_year:${b.year}` : "",
    `biblio.first_page:${b.firstPage}`,
    b.volume ? `biblio.volume:${b.volume}` : "",
  ]
    .filter(Boolean)
    .join(",");
  const r = await oa<{ results: OAWork[] }>("/works", { filter, per_page: "3", select: SELECT });
  return r.results[0] ?? null;
}

export async function findByTitle(title: string): Promise<OAWork | null> {
  const r = await oa<{ results: OAWork[] }>("/works", { search: title.slice(0, 250), per_page: "5", select: SELECT });
  let best: OAWork | null = null;
  let bs = 0;
  for (const w of r.results) {
    const s = dice(title, w.display_name ?? "");
    if (s > bs) (best = w), (bs = s);
  }
  return bs >= 0.75 ? best : null;
}

export async function getWorksByIds(ids: string[]): Promise<OAWork[]> {
  const out: OAWork[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).map(shortId);
    const r = await oa<{ results: OAWork[] }>("/works", { filter: `openalex:${chunk.join("|")}`, per_page: "50", select: SELECT });
    out.push(...r.results);
  }
  return out;
}

export async function listWorks(params: { filter?: string; search?: string; sort?: string; perPage?: number }): Promise<OAWork[]> {
  const q: Record<string, string> = { per_page: String(params.perPage ?? 25), select: SELECT };
  if (params.filter) q.filter = params.filter;
  if (params.search) q.search = params.search;
  if (params.sort) q.sort = params.sort;
  const r = await oa<{ results: OAWork[] }>("/works", q);
  return r.results;
}

export function issnFilter(issns: string[]): string | undefined {
  const list = [...new Set(issns.map((x) => x.toUpperCase()))].slice(0, 100);
  return list.length ? `primary_location.source.issn:${list.join("|")}` : undefined;
}
