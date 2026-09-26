import { requireAuth } from "@/lib/server/auth";

export const maxDuration = 60;

// Streams an open-access PDF through our origin when the publisher blocks CORS.
export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const url = new URL(req.url).searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return Response.json({ error: "bad url" }, { status: 400 });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") return Response.json({ error: "bad protocol" }, { status: 400 });
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/.test(target.hostname)) return Response.json({ error: "blocked host" }, { status: 400 });
  const res = await fetch(target, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 PaperSunshine/0.1", accept: "application/pdf,*/*" } });
  if (!res.ok || !res.body) return Response.json({ error: `upstream ${res.status}` }, { status: 502 });
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("pdf") && !type.includes("octet-stream")) return Response.json({ error: "not a pdf", type }, { status: 415 });
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > 60 * 1024 * 1024) return Response.json({ error: "too large" }, { status: 413 });
  return new Response(res.body, { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}
