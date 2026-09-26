"use client";
// Recovering from "version skew": after a new deploy, a page that was opened
// earlier may ask for code files the new deploy no longer has. Reloading once
// picks up the new version; the guard avoids reload loops.

export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

export function isChunkError(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  const msg = `${err?.name ?? ""} ${err?.message ?? String(e ?? "")}`;
  return /ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load chunk/i.test(msg);
}

export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem("ps-reload-at") ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem("ps-reload-at", String(Date.now()));
  } catch {
    /* ignore */
  }
  location.reload();
  return true;
}

let installed = false;
export function installRecovery() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    if (isChunkError(e.error ?? e.message)) reloadOnce();
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (isChunkError(e.reason)) reloadOnce();
  });
}

export function describeError(e: unknown): string {
  const err = e as { name?: string; message?: string; stack?: string; digest?: string } | null;
  const lines = [
    `${err?.name ?? "Error"}: ${err?.message ?? String(e)}`,
    err?.digest ? `digest: ${err.digest}` : "",
    `build: ${BUILD_ID || "local"}`,
    `page: ${typeof location !== "undefined" ? location.pathname + location.search : ""}`,
    `ua: ${typeof navigator !== "undefined" ? navigator.userAgent : ""}`,
    (err?.stack ?? "").split("\n").slice(0, 8).join("\n"),
  ];
  return lines.filter(Boolean).join("\n");
}
