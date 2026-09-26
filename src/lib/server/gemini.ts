// Minimal Gemini REST client (generateContent + SSE streaming). Plain fetch, no
// SDK, so it runs on any Node runtime. Follows the Gemini 3.x migration notes:
// `thinkingLevel` instead of thinking_budget, and no temperature/top_p.

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}
export interface Content {
  role: "user" | "model";
  parts: Part[];
}

export function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

export function modelFor(kind: "translate" | "chat", requested?: string): string {
  if (requested && /^[a-z0-9][a-z0-9.\-]{2,60}$/i.test(requested)) return requested;
  if (kind === "translate") return process.env.GEMINI_MODEL_TRANSLATE || "gemini-3.8-flash";
  return process.env.GEMINI_MODEL_CHAT || "gemini-3.8-flash";
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number, // seconds, from Google's RetryInfo
    public quota?: string, // e.g. GenerateRequestsPerDayPerProjectPerModel-FreeTier
  ) {
    super(message);
  }
}

/** Pulls retryDelay / quotaId out of a Google API error body. */
function parseGoogleError(body: string): { message: string; retryAfter?: number; quota?: string } {
  try {
    const j = JSON.parse(body) as {
      error?: { message?: string; details?: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[] };
    };
    let retryAfter: number | undefined;
    let quota: string | undefined;
    for (const d of j.error?.details ?? []) {
      if (d.retryDelay) retryAfter = Math.ceil(parseFloat(d.retryDelay));
      if (d.violations?.[0]?.quotaId) quota = d.violations[0].quotaId;
    }
    return { message: j.error?.message ?? body.slice(0, 300), retryAfter, quota };
  } catch {
    return { message: body.slice(0, 300) };
  }
}

/** JSON body for route error responses, so the client can back off correctly. */
export function errorPayload(e: unknown) {
  if (e instanceof GeminiError) return { error: e.message, retryAfter: e.retryAfter, quota: e.quota, status: e.status };
  return { error: e instanceof Error ? e.message : String(e), status: 500 };
}

export interface GenOptions {
  model: string;
  system: string;
  contents: Content[];
  schema?: unknown;
  json?: boolean;
  thinking?: "low" | "medium" | "high";
  maxOutputTokens?: number;
}

function buildBody(o: GenOptions, variant: number) {
  const generationConfig: Record<string, unknown> = {};
  if (o.json) generationConfig.responseMimeType = "application/json";
  if (o.schema && variant < 2) generationConfig.responseSchema = o.schema;
  // Flash-Lite models do not think by default; sending thinkingConfig can 400 and waste a request.
  if (o.thinking && variant < 1 && !/lite/i.test(o.model)) generationConfig.thinkingConfig = { thinkingLevel: o.thinking };
  if (o.maxOutputTokens) generationConfig.maxOutputTokens = o.maxOutputTokens;
  return {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: o.contents,
    generationConfig,
  };
}

async function post(model: string, method: string, body: unknown, query = ""): Promise<Response> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new GeminiError("GEMINI_API_KEY is not set", 500);
  return fetch(`${BASE}/${encodeURIComponent(model)}:${method}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Calls generateContent, retrying transient errors and degrading config on 400. */
export async function generate(o: GenOptions): Promise<{ text: string; usage?: unknown }> {
  let variant = 0;
  let attempt = 0;
  for (;;) {
    const res = await post(o.model, "generateContent", buildBody(o, variant));
    if (res.ok) {
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
        usageMetadata?: unknown;
        promptFeedback?: { blockReason?: string };
      };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts
        .filter((p) => !p.thought && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
      if (!text && data.promptFeedback?.blockReason) throw new GeminiError(`blocked: ${data.promptFeedback.blockReason}`, 422);
      return { text, usage: data.usageMetadata };
    }
    const detail = await res.text().catch(() => "");
    const g = parseGoogleError(detail);
    if (res.status === 400 && variant < 2 && !/API key/i.test(g.message)) {
      variant++; // drop thinkingConfig, then responseSchema
      continue;
    }
    // Short waits are cheap to absorb here; long ones go back to the client,
    // which pauses and slows down instead of holding a server function open.
    if (res.status === 429 && attempt < 1 && (g.retryAfter ?? 2) <= 6) {
      attempt++;
      await sleep((g.retryAfter ?? 2) * 1000 + 300);
      continue;
    }
    if (res.status >= 500 && attempt < 2) {
      attempt++;
      await sleep(1500 * attempt);
      continue;
    }
    console.error(`[gemini] ${o.model} ${res.status}`, g.quota ?? "", g.message);
    throw new GeminiError(`Gemini ${res.status}: ${g.message}`, res.status, g.retryAfter, g.quota);
  }
}

export function parseJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new GeminiError("model returned invalid JSON", 502);
  }
}

/** Streams plain text chunks from streamGenerateContent (SSE). */
export async function streamText(o: GenOptions): Promise<ReadableStream<Uint8Array>> {
  let res = await post(o.model, "streamGenerateContent", buildBody(o, 0), "?alt=sse");
  if (res.status === 400) res = await post(o.model, "streamGenerateContent", buildBody(o, 1), "?alt=sse");
  if (res.status === 429 || res.status >= 500) {
    await sleep(2000);
    res = await post(o.model, "streamGenerateContent", buildBody(o, 1), "?alt=sse");
  }
  if (!res.ok || !res.body) {
    const g = parseGoogleError(await res.text().catch(() => ""));
    console.error(`[gemini-stream] ${o.model} ${res.status}`, g.quota ?? "", g.message);
    throw new GeminiError(`Gemini ${res.status}: ${g.message}`, res.status, g.retryAfter, g.quota);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        let emitted = false;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const data = JSON.parse(payload) as {
              candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
            };
            for (const p of data.candidates?.[0]?.content?.parts ?? []) {
              if (p.thought || !p.text) continue;
              controller.enqueue(encoder.encode(p.text));
              emitted = true;
            }
          } catch {
            /* ignore partial frames */
          }
        }
        if (emitted) return;
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
}

// Schema helpers (Gemini OpenAPI subset)
export const S = {
  str: (description?: string) => ({ type: "STRING", ...(description ? { description } : {}) }),
  int: () => ({ type: "INTEGER" }),
  num: () => ({ type: "NUMBER" }),
  enumOf: (values: string[]) => ({ type: "STRING", enum: values }),
  arr: (items: unknown) => ({ type: "ARRAY", items }),
  obj: (properties: Record<string, unknown>, required?: string[]) => ({
    type: "OBJECT",
    properties,
    required: required ?? Object.keys(properties),
  }),
};
