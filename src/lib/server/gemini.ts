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
  ) {
    super(message);
  }
}

interface GenOptions {
  model: string;
  system: string;
  contents: Content[];
  schema?: unknown;
  json?: boolean;
  thinking?: "low" | "medium" | "high";
}

function buildBody(o: GenOptions, variant: number) {
  const generationConfig: Record<string, unknown> = {};
  if (o.json) generationConfig.responseMimeType = "application/json";
  if (o.schema && variant < 2) generationConfig.responseSchema = o.schema;
  if (o.thinking && variant < 1) generationConfig.thinkingConfig = { thinkingLevel: o.thinking };
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
    if (res.status === 400 && variant < 2) {
      variant++; // drop thinkingConfig, then responseSchema
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      attempt++;
      await sleep(1500 * 2 ** attempt + Math.random() * 500);
      continue;
    }
    throw new GeminiError(`Gemini ${res.status}: ${detail.slice(0, 400)}`, res.status);
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
    const detail = await res.text().catch(() => "");
    throw new GeminiError(`Gemini ${res.status}: ${detail.slice(0, 400)}`, res.status);
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
