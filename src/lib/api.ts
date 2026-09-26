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
    public retryAfter?: number,
    public quota?: string,
    public perDayFlag?: boolean,
  ) {
    super(message);
  }
  /** Daily free-tier quota exhausted: retrying today is pointless. */
  get perDay() {
    return !!this.perDayFlag || (!!this.quota && /PerDay/i.test(this.quota));
  }
}

async function errorFrom(r: Response): Promise<ApiError> {
  let msg = `${r.status}`;
  let retryAfter: number | undefined;
  let quota: string | undefined;
  let perDay: boolean | undefined;
  try {
    const j = (await r.json()) as { error?: string; retryAfter?: number; quota?: string; perDay?: boolean };
    msg = j.error ?? msg;
    retryAfter = j.retryAfter;
    quota = j.quota;
    perDay = j.perDay;
  } catch {
    if (r.status === 504) msg = "伺服器處理逾時（Vercel 504）";
  }
  return new ApiError(msg, r.status, retryAfter, quota, perDay);
}

/** Human-readable message for any API failure. */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 429)
      return e.perDay
        ? "今日免費額度已用完。可到「設定 → 模型」改用其他方案（例如 DeepSeek），或到 Google AI Studio 開啟計費；額度每天重置。"
        : `請求太頻繁，約 ${e.retryAfter ?? 30} 秒後再試。`;
    if (e.status === 401) return "網站密碼錯誤或未輸入（APP_PASSCODE）。";
    if (e.status === 404) return `模型名稱不存在，請到「設定 → 模型」確認。（${e.message}）`;
    if (/未設定/.test(e.message)) return `${e.message}。請到 Vercel 的環境變數加入金鑰後重新部署。`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export async function health(): Promise<HealthResponse> {
  const r = await fetch("/api/health", { headers: headers(false), cache: "no-store" });
  return (await r.json()) as HealthResponse;
}

export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal, timeoutMs = 0): Promise<T> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
  let r: Response;
  try {
    r = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted && !signal?.aborted) throw new ApiError(`逾時（超過 ${Math.round(timeoutMs / 1000)} 秒沒有回應）`, 408);
    throw new ApiError(`網路錯誤：${e instanceof Error ? e.message : e}`, 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
  if (!r.ok) throw await errorFrom(r);
  return (await r.json()) as T;
}

export function aiJson<T>(body: JsonTaskRequest, signal?: AbortSignal, timeoutMs = 150_000): Promise<T> {
  return postJson<T>("/api/ai/json", body, signal, timeoutMs);
}

/** Streams text from /api/ai/stream, calling onText with the accumulated answer. */
export async function aiStream(body: StreamRequest, onText: (full: string) => void, signal?: AbortSignal): Promise<string> {
  const r = await fetch("/api/ai/stream", { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
  if (!r.ok || !r.body) throw await errorFrom(r);
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

/**
 * Streams "<sid>\t<text>" lines from /api/ai/translate. Aborts if nothing
 * arrives for `idleMs` (a stuck upstream), so the caller can retry.
 */
export async function streamLines(
  body: unknown,
  onLine: (line: string) => void,
  opts: { signal?: AbortSignal; idleMs?: number } = {},
): Promise<{ mock: boolean; model?: string }> {
  const ctrl = new AbortController();
  const idleMs = opts.idleMs ?? 90_000;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let idled = false;
  const poke = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      idled = true;
      ctrl.abort();
    }, idleMs);
  };
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  poke();
  try {
    let r: Response;
    try {
      r = await fetch("/api/ai/translate", { method: "POST", headers: headers(), body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      if (idled) throw new ApiError(`逾時（${Math.round(idleMs / 1000)} 秒沒有回應）`, 408);
      throw new ApiError(`網路錯誤：${e instanceof Error ? e.message : e}`, 0);
    }
    if (!r.ok || !r.body) throw await errorFrom(r);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        poke();
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          onLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      }
    } catch (e) {
      if (idled) throw new ApiError(`逾時（${Math.round(idleMs / 1000)} 秒沒有新內容）`, 408);
      throw e;
    }
    if (buf.trim()) onLine(buf);
    return { mock: r.headers.get("x-mock") === "1", model: r.headers.get("x-model") ?? undefined };
  } finally {
    clearTimeout(idle);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
