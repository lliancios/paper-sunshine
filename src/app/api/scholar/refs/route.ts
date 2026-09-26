import { requireAuth } from "@/lib/server/auth";
import { getWork, getWorksByIds, hasOpenAlex, listWorks, shortId, toMeta } from "@/lib/server/openalex";

export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { openalexId, doi } = (await req.json()) as { openalexId?: string; doi?: string };
  if (!hasOpenAlex()) return Response.json({ references: [], citedBy: [], note: "OPENALEX_API_KEY 未設定" });
  try {
    const seed = await getWork({ id: openalexId, doi });
    if (!seed) return Response.json({ references: [], citedBy: [], note: "OpenAlex 找不到這篇論文" });
    const [refs, citing] = await Promise.all([
      getWorksByIds((seed.referenced_works ?? []).slice(0, 150)),
      listWorks({ filter: `cites:${shortId(seed.id)}`, sort: "cited_by_count:desc", perPage: 25 }),
    ]);
    return Response.json({
      references: refs.map(toMeta).sort((a, b) => (a.authors[0]?.family ?? "").localeCompare(b.authors[0]?.family ?? "")),
      citedBy: citing.map(toMeta),
    });
  } catch (e) {
    return Response.json({ references: [], citedBy: [], error: String(e) }, { status: 502 });
  }
}
