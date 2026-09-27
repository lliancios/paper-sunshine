import { requireAuth } from "@/lib/server/auth";

export const maxDuration = 60;

// Thin proxy to the Zotero Web API (v3). The user's Zotero key comes from the
// browser on each request (header x-zotero-key) and is never stored here.
const BASE = (process.env.ZOTERO_API_BASE || "https://api.zotero.org").replace(/\/+$/, "");
const KEY = "[A-Z0-9]{8}";
const ALLOWED = new RegExp(
  `^/(keys/current|users/\\d+/(collections(/${KEY}(/items(/top)?|/collections)?)?|items(/top)?|items/${KEY}(/children|/file)?))$`,
);

async function handle(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  if (!ALLOWED.test(path)) return Response.json({ error: "path not allowed" }, { status: 400 });
  const key = req.headers.get("x-zotero-key") ?? "";
  if (!/^[A-Za-z0-9]{10,64}$/.test(key)) return Response.json({ error: "missing Zotero key" }, { status: 400 });

  const qs = new URLSearchParams(url.searchParams);
  qs.delete("path");
  const mode = qs.get("mode");
  qs.delete("mode");
  const target = `${BASE}${path}${[...qs].length ? `?${qs}` : ""}`;
  const headers: Record<string, string> = { "Zotero-API-Key": key, "Zotero-API-Version": "3" };

  if (path.endsWith("/file")) {
    // Prefer handing the browser the storage link (no size limit on our side);
    // "stream" mode pipes the file through when the browser can't fetch it directly.
    const first = await fetch(target, { headers, redirect: "manual" });
    const loc = first.headers.get("location");
    if (mode !== "stream" && first.status >= 300 && first.status < 400 && loc) return Response.json({ url: loc });
    const res = first.status === 200 ? first : await fetch(target, { headers });
    if (!res.ok || !res.body) return Response.json({ error: `Zotero ${res.status}` }, { status: res.status === 404 ? 404 : 502 });
    return new Response(res.body, { headers: { "content-type": res.headers.get("content-type") ?? "application/pdf", "cache-control": "no-store" } });
  }

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET") {
    headers["Content-Type"] = "application/json";
    const v = req.headers.get("if-unmodified-since-version");
    if (v) headers["If-Unmodified-Since-Version"] = v;
    init.body = await req.text();
  }
  const res = await fetch(target, init);
  const empty = res.status === 204 || res.status === 304; // e.g. PATCH success: no body allowed
  return new Response(empty ? null : await res.text(), {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
      "x-total-results": res.headers.get("total-results") ?? "",
      "x-last-version": res.headers.get("last-modified-version") ?? "",
      "cache-control": "no-store",
    },
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
