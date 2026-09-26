import type { WorkMeta } from "@/lib/apiTypes";
import { requireAuth } from "@/lib/server/auth";
import { crossrefSearch, crossrefToMeta } from "@/lib/server/crossref";
import { dice, findByBiblio, findByTitle, getWork, hasOpenAlex, toMeta } from "@/lib/server/openalex";

export const maxDuration = 60;

interface Body {
  doi?: string;
  title?: string;
  titles?: string[]; // candidate titles from the PDF layout, best first
  issn?: string[];
  year?: number;
  volume?: string;
  firstPage?: string;
}

/**
 * Finds a paper's bibliographic record. Order: DOI → journal+year+page →
 * OpenAlex title search → Crossref (then back to OpenAlex by DOI).
 */
export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const b = (await req.json()) as Body;
  const tried: string[] = [];
  const titles = [...new Set([...(b.titles ?? []), b.title].filter((t): t is string => !!t && t.length > 10))].slice(0, 3);
  const oaOn = hasOpenAlex();
  const done = (work: WorkMeta | null, via: string) => Response.json({ work, via, tried });

  try {
    if (oaOn && b.doi) {
      const w = await getWork({ doi: b.doi }).catch((e) => (tried.push(`doi: ${e}`), null));
      if (w) return done(toMeta(w), "doi");
      tried.push("doi: not found");
    }
    if (oaOn && b.issn?.length && b.firstPage) {
      const w = await findByBiblio({ issn: b.issn, year: b.year, firstPage: b.firstPage, volume: b.volume }).catch((e) => (tried.push(`biblio: ${e}`), null));
      if (w) return done(toMeta(w), "biblio");
      tried.push("biblio: not found");
    }
    if (oaOn) {
      for (const t of titles) {
        const w = await findByTitle(t).catch((e) => (tried.push(`title: ${e}`), null));
        if (w) return done(toMeta(w), "title");
      }
      tried.push("title: not found");
    }
    // Crossref fallback (also works without an OpenAlex key)
    for (const t of titles.length ? titles : [undefined]) {
      const items = await crossrefSearch({ title: t, issn: b.issn?.[0], year: b.year, firstPage: b.firstPage }).catch((e) => (tried.push(`crossref: ${e}`), []));
      const best = items.find((i) => (t ? dice(t, i.title?.[0] ?? "") >= 0.8 : !!b.firstPage));
      if (best) {
        const viaOa = oaOn ? await getWork({ doi: best.DOI }).catch(() => null) : null;
        return done(viaOa ? toMeta(viaOa) : crossrefToMeta(best), "crossref");
      }
    }
    tried.push("crossref: not found");
    console.error("[lookup] no match", JSON.stringify({ b, tried }));
    return done(null, "none");
  } catch (e) {
    console.error("[lookup] failed", e);
    return Response.json({ work: null, error: String(e), tried }, { status: 502 });
  }
}
