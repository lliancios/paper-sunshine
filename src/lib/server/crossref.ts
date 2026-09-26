// Crossref fallback for finding a DOI when the PDF does not print one.
// Free, no key; we identify ourselves politely via the User-Agent.
import type { WorkMeta } from "../apiTypes";

interface CrItem {
  DOI: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  "container-title"?: string[];
  ISSN?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  issued?: { "date-parts"?: number[][] };
  type?: string;
  abstract?: string;
}

export async function crossrefSearch(params: { title?: string; issn?: string; year?: number; firstPage?: string }): Promise<CrItem[]> {
  const qs = new URLSearchParams({ rows: "5", select: "DOI,title,author,container-title,ISSN,volume,issue,page,issued,type" });
  if (params.title) qs.set("query.bibliographic", params.title.slice(0, 300));
  const filters: string[] = [];
  if (params.issn) filters.push(`issn:${params.issn}`);
  if (params.year) filters.push(`from-pub-date:${params.year},until-pub-date:${params.year}`);
  if (filters.length) qs.set("filter", filters.join(","));
  const res = await fetch(`https://api.crossref.org/works?${qs}`, {
    headers: { "user-agent": "PaperSunshine/0.1 (https://github.com/lliancios/paper-sunshine)" },
  });
  if (!res.ok) throw new Error(`Crossref ${res.status}`);
  const j = (await res.json()) as { message?: { items?: CrItem[] } };
  let items = j.message?.items ?? [];
  if (params.firstPage) {
    const exact = items.filter((i) => i.page?.split(/[-–]/)[0] === params.firstPage);
    if (exact.length) items = exact;
  }
  return items;
}

export function crossrefToMeta(i: CrItem): WorkMeta {
  const [first, last] = (i.page ?? "").split(/[-–]/);
  return {
    doi: i.DOI.toLowerCase(),
    title: i.title?.[0] ?? i.DOI,
    authors: (i.author ?? []).map((a) => ({
      display: a.name ?? [a.given, a.family].filter(Boolean).join(" "),
      family: a.family ?? a.name ?? "",
      given: a.given,
    })),
    year: i.issued?.["date-parts"]?.[0]?.[0],
    journal: i["container-title"]?.[0],
    issn: i.ISSN,
    volume: i.volume,
    issue: i.issue,
    firstPage: first || undefined,
    lastPage: last || undefined,
    landing: `https://doi.org/${i.DOI}`,
    type: i.type,
  };
}
