/* Paper Sunshine service worker: makes the installed app open and read
 * already-imported papers offline. Papers, translations and notes live in
 * IndexedDB, so the worker only has to cache the app shell and static assets.
 *
 * - /_next/static, /pdfjs: cache first (content-hashed or versioned files)
 * - page navigations: network first, cached shell when offline
 * - /api and RSC requests: never cached
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "0";
const STATIC = `ps-static-${VERSION}`;
const PAGES = `ps-pages-${VERSION}`;
const SHELLS = ["/", "/read"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const pages = await caches.open(PAGES);
      const statics = await caches.open(STATIC);
      for (const path of SHELLS) {
        try {
          const res = await fetch(path, { credentials: "same-origin" });
          if (!res.ok) continue;
          const html = await res.clone().text();
          await pages.put(path, res);
          // Precache every static chunk the shell references so the reader
          // opens offline even if it was never visited on this device.
          const assets = new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) || []);
          await Promise.all(
            [...assets].map((a) =>
              statics.match(a).then((hit) => hit || fetch(a).then((r) => (r.ok ? statics.put(a, r) : undefined)).catch(() => undefined)),
            ),
          );
        } catch {
          /* offline during install: cache fills on next visit */
        }
      }
      try {
        await statics.add("/pdfjs/pdf.worker.min.mjs");
      } catch {
        /* ignore */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, PAGES]);
      for (const key of await caches.keys()) if (key.startsWith("ps-") && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

/** Cache key for a page navigation: the reader shell is shared by every paper. */
function pageKey(url) {
  if (url.pathname === "/read" || url.pathname.startsWith("/read/")) return "/read";
  return url.pathname;
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req, { ignoreSearch: false });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") cache.put(req, res.clone());
  return res;
}

async function networkFirstPage(req) {
  const url = new URL(req.url);
  const key = pageKey(url);
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic" && !res.redirected) cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match(key)) || (await cache.match("/"));
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  return hit || (await fresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (req.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pdfjs/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirstPage(req));
    return;
  }
  if (url.pathname === "/icon" || url.pathname === "/apple-icon" || url.pathname === "/icon-maskable" || url.pathname === "/manifest.webmanifest" || url.pathname === "/favicon.ico") {
    event.respondWith(staleWhileRevalidate(req));
  }
});
