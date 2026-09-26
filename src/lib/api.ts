"use client";
// Client-side API helpers. The passcode lives only in this browser.
import type { HealthResponse, JsonTaskRequest, StreamRequest } from "./apiTypes";

const PASS_KEY = "ps-passcode";

export function getPasscode(): string {
  try {
    return localStorage.getItem(PASS_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setPasscode(v: string) {
  try {
    localStorage.setItem(PASS_KEY, v);
  } catch {
    /* private mode */
  }
}

function headers(json = true): HeadersInit {
  return { ...(json ? { "content-type": "application/json" } : {}), "x-ps-pass": getPasscode() };
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function health(): Promise<HealthResponse> {
  const r = await fetch("/api/health", { headers: headers(false), cache: "no-store" });
  return (await r.json()) as HealthResponse;
}

export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      const j = (await r.json()) as { error?: string };
      msg = j.error ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiError(msg, r.status);
  }
  return (await r.json()) as T;
}

export function aiJson<T>(body: JsonTaskRequest, signal?: AbortSignal): Promise<T> {
  return postJson<T>("/api/ai/json", body, signal);
}

/** Streams text from /api/ai/stream, calling onText with the accumulated answer. */
export async function aiStream(body: StreamRequest, onText: (full: string) => void, signal?: AbortSignal): Promise<string> {
  const r = await fetch("/api/ai/stream", { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) {
    let msg = `${r.status}`;
    try {
      msg = ((await r.json()) as { error?: string }).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, r.status);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    full += dec.decode(value, { stream: true });
    onText(full);
  }
  return full;
}

export async function fetchPdfBlob(url: string): Promise<Blob> {
  const isPdf = (b: Blob, head: string) => b.size > 1000 && head.startsWith("%PDF");
  const check = async (b: Blob) => isPdf(b, await b.slice(0, 5).text());
  try {
    const direct = await fetch(url, { mode: "cors" });
    if (direct.ok) {
      const b = await direct.blob();
      if (await check(b)) return b;
    }
  } catch {
    /* CORS blocked, fall back to our proxy */
  }
  const r = await fetch(`/api/fetch-pdf?url=${encodeURIComponent(url)}`, { headers: headers(false) });
  if (!r.ok) throw new ApiError(`無法下載 PDF（${r.status}）`, r.status);
  const b = await r.blob();
  if (!(await check(b))) throw new ApiError("下載的檔案不是 PDF", 415);
  return b;
}
