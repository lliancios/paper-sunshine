import { requireAuth } from "@/lib/server/auth";
import { findByTitle, getWork, hasOpenAlex, toMeta } from "@/lib/server/openalex";

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { doi, title } = (await req.json()) as { doi?: string; title?: string };
  if (!hasOpenAlex()) return Response.json({ work: null, note: "OPENALEX_API_KEY 未設定" });
  try {
    let w = doi ? await getWork({ doi }) : null;
    if (!w && title && title.length > 10) w = await findByTitle(title);
    return Response.json({
      work: w ? toMeta(w) : null,
      referenced: w?.referenced_works?.length ?? 0,
    });
  } catch (e) {
    return Response.json({ work: null, error: String(e) }, { status: 502 });
  }
}
