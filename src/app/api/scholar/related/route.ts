import type { RelatedItem, RerankItem, WorkMeta } from "@/lib/apiTypes";
import { type Journal, matchJournal } from "@/lib/defaults";
import { requireAuth } from "@/lib/server/auth";
import { generate, hasGemini, modelFor, parseJson } from "@/lib/server/gemini";
import { type OAWork, getWork, getWorksByIds, hasOpenAlex, issnFilter, listWorks, shortId, toMeta } from "@/lib/server/openalex";
import { rerankPrompt } from "@/lib/server/prompts";

export const maxDuration = 90;

interface Body {
  mode: "forYou" | "trending";
  openalexId?: string;
  doi?: string;
  title: string;
  abstract?: string;
  keywords: string[];
  queries: string[]; // research-topic searches from Settings
  researchContext: string;
  journals: Journal[];
  onlyWhitelist: boolean;
  exclude: string[]; // DOIs already in the library
}

const SOURCE_LABEL: Record<string, string> = {
  cites: "引用了本篇",
  ref: "本篇的參考文獻",
  related: "OpenAlex 相關作品",
  search: "與本篇關鍵詞相符",
  topic: "符合你的研究主題",
};

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const b = (await req.json()) as Body;
  if (!hasOpenAlex()) return Response.json({ items: [], note: "OPENALEX_API_KEY 未設定，無法搜尋相關論文" });
  const wl = issnFilter(b.journals.flatMap((j) => j.issn));
  const wlFilter = b.onlyWhitelist && wl ? wl : undefined;
  const exclude = new Set(b.exclude.map((d) => d.toLowerCase()));

  try {
    if (b.mode === "trending") {
      const since = new Date();
      since.setFullYear(since.getFullYear() - 3);
      const filter = [wl, `from_publication_date:${since.toISOString().slice(0, 10)}`, "type:article"].filter(Boolean).join(",");
      const query = (b.keywords.slice(0, 3).join(" ") || b.queries[0] || b.title).slice(0, 200);
      const works = await listWorks({ filter, search: query, perPage: 25 });
      const items = works
        .map(toMeta)
        .filter((w) => !w.doi || !exclude.has(w.doi))
        .sort((x, y) => (y.citedBy ?? 0) - (x.citedBy ?? 0))
        .slice(0, 15)
        .map((w) => ({ ...w, score: 0, reason: `近三年，被引用 ${w.citedBy ?? 0} 次`, sources: ["search"], tier: matchJournal(b.journals, w.journal, w.issn)?.tier }));
      return Response.json({ items });
    }

    const seed = await getWork({ id: b.openalexId, doi: b.doi });
    const cands = new Map<string, { w: OAWork; sources: Set<string> }>();
    const add = (list: OAWork[], src: string) => {
      for (const w of list) {
        const id = shortId(w.id);
        if (seed && id === shortId(seed.id)) continue;
        const e = cands.get(id) ?? { w, sources: new Set<string>() };
        e.sources.add(src);
        cands.set(id, e);
      }
    };
    const jobs: Promise<void>[] = [];
    if (seed) {
      jobs.push(getWorksByIds((seed.related_works ?? []).slice(0, 25)).then((l) => add(l, "related")));
      jobs.push(
        listWorks({ filter: [`cites:${shortId(seed.id)}`, wlFilter].filter(Boolean).join(","), sort: "cited_by_count:desc", perPage: 30 }).then((l) =>
          add(l, "cites"),
        ),
      );
      jobs.push(getWorksByIds((seed.referenced_works ?? []).slice(0, 50)).then((l) => add(l, "ref")));
    }
    const kw = b.keywords.slice(0, 4).join(" ");
    if (kw) jobs.push(listWorks({ search: kw, filter: wlFilter, perPage: 25 }).then((l) => add(l, "search")));
    for (const q of b.queries.slice(0, 2)) if (q.trim()) jobs.push(listWorks({ search: q.trim(), filter: wlFilter, perPage: 20 }).then((l) => add(l, "topic")));
    await Promise.allSettled(jobs);

    // Pre-score, then let Gemini judge construct-level relevance.
    const year = new Date().getFullYear();
    let pool: RelatedItem[] = [];
    for (const { w, sources } of cands.values()) {
      const m: WorkMeta = toMeta(w);
      if (m.doi && exclude.has(m.doi)) continue;
      const j = matchJournal(b.journals, m.journal, m.issn);
      if (b.onlyWhitelist && !j) continue;
      if (m.type && !["article", "review", "book-chapter", "preprint"].includes(m.type)) continue;
      const pre =
        (sources.has("cites") ? 3 : 0) +
        (sources.has("related") ? 2 : 0) +
        (sources.has("ref") ? 1.5 : 0) +
        (sources.has("topic") ? 2.5 : 0) +
        (sources.has("search") ? 1.5 : 0) +
        Math.log10((m.citedBy ?? 0) + 1) +
        (j ? (j.tier === 1 ? 2 : j.tier === 2 ? 1.5 : 0.5) : 0) +
        (m.year ? Math.max(0, 1 - (year - m.year) / 25) : 0);
      pool.push({
        ...m,
        score: pre,
        reason: [...sources].map((s) => SOURCE_LABEL[s]).join("、"),
        sources: [...sources],
        tier: j?.tier,
      });
    }
    pool.sort((x, y) => y.score - x.score);
    pool = pool.slice(0, 30);
    const maxPre = Math.max(1, ...pool.map((p) => p.score));
    for (const p of pool) p.score = Math.round((p.score / maxPre) * 80);

    if (hasGemini() && pool.length) {
      try {
        const { system, user, schema } = rerankPrompt({
          task: "rerank",
          paper: { title: b.title, abstract: b.abstract?.slice(0, 800), keywords: b.keywords },
          researchContext: b.researchContext,
          candidates: pool.map((p) => ({ id: p.openalexId ?? "", title: p.title, abstract: p.abstract?.slice(0, 350), venue: p.journal, year: p.year })),
        });
        const { text } = await generate({ model: modelFor("translate"), system, contents: [{ role: "user", parts: [{ text: user }] }], schema, json: true, thinking: "low" });
        const ranked = parseJson<{ items?: RerankItem[] }>(text).items ?? [];
        const byId = new Map(ranked.map((r) => [r.id, r]));
        for (const p of pool) {
          const r = byId.get(p.openalexId ?? "");
          if (r) {
            p.score = Math.max(0, Math.min(100, Math.round(r.score)));
            p.reason = `${r.reason}（${p.reason}）`;
          }
        }
        pool.sort((x, y) => y.score - x.score);
      } catch {
        /* keep pre-scores */
      }
    }
    return Response.json({ items: pool.slice(0, 20), seed: seed ? toMeta(seed) : null });
  } catch (e) {
    return Response.json({ items: [], error: String(e) }, { status: 502 });
  }
}
