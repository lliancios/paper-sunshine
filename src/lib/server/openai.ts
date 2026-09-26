// OpenAI-compatible Chat Completions client. Covers DeepSeek, OpenRouter,
// SiliconFlow, Groq and any custom endpoint that speaks the same protocol.
import type { Content } from "./gemini";

export type OaiProvider = "deepseek" | "openrouter" | "siliconflow" | "groq" | "custom";

const PROVIDERS: Record<OaiProvider, { base: () => string | undefined; key: () => string | undefined }> = {
  deepseek: { base: () => process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", key: () => process.env.DEEPSEEK_API_KEY },
  openrouter: { base: () => "https://openrouter.ai/api/v1", key: () => process.env.OPENROUTER_API_KEY },
  siliconflow: { base: () => process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.com/v1", key: () => process.env.SILICONFLOW_API_KEY },
  groq: { base: () => "https://api.groq.com/openai/v1", key: () => process.env.GROQ_API_KEY },
  custom: { base: () => process.env.CUSTOM_LLM_BASE_URL, key: () => process.env.CUSTOM_LLM_API_KEY },
};

export function oaiAvailable(p: OaiProvider): boolean {
  return !!PROVIDERS[p].key() && !!PROVIDERS[p].base();
}

export class OaiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number,
    public perDay?: boolean,
  ) {
    super(message);
  }
}

interface OaiOptions {
  provider: OaiProvider;
  model: string;
  system: string;
  contents: Content[];
  json?: boolean;
  maxOutputTokens?: number;
}

function toMessages(system: string, contents: Content[]) {
  const msgs: { role: string; content: unknown }[] = [{ role: "system", content: system }];
  for (const c of contents) {
    const hasImage = c.parts.some((p) => p.inlineData);
    if (!hasImage) {
      msgs.push({ role: c.role === "model" ? "assistant" : "user", content: c.parts.map((p) => p.text ?? "").join("") });
      continue;
    }
    msgs.push({
      role: c.role === "model" ? "assistant" : "user",
      content: c.parts.map((p) =>
        p.inlineData ? { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } } : { type: "text", text: p.text ?? "" },
      ),
    });
  }
  return msgs;
}

async function post(o: OaiOptions, stream: boolean): Promise<Response> {
  const cfg = PROVIDERS[o.provider];
  const key = cfg.key();
  const base = cfg.base();
  if (!key || !base) throw new OaiError(`${o.provider} 未設定 API key`, 500);
  const body: Record<string, unknown> = { model: o.model, messages: toMessages(o.system, o.contents), stream };
  if (o.json) body.response_format = { type: "json_object" };
  if (o.maxOutputTokens) body.max_tokens = o.maxOutputTokens;
  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      ...(o.provider === "openrouter" ? { "x-title": "Paper Sunshine" } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string };
      message = typeof j.error === "string" ? j.error : j.error?.message ?? message;
    } catch {
      /* not json */
    }
    const ra = Number(res.headers.get("retry-after"));
    console.error(`[${o.provider}] ${o.model} ${res.status}`, message);
    throw new OaiError(`${o.provider} ${res.status}: ${message}`, res.status, Number.isFinite(ra) && ra > 0 ? ra : undefined, /per.?day|daily/i.test(message));
  }
  return res;
}

export async function oaiGenerate(o: OaiOptions): Promise<string> {
  const res = await post(o, false);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? "";
}

export async function oaiStream(o: OaiOptions): Promise<ReadableStream<Uint8Array>> {
  const res = await post(o, true);
  if (!res.body) throw new OaiError("empty stream", 502);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buffer = "";
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        buffer += dec.decode(value, { stream: true });
        let idx: number;
        let emitted = false;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
            const t = j.choices?.[0]?.delta?.content;
            if (t) {
              controller.enqueue(enc.encode(t));
              emitted = true;
            }
          } catch {
            /* partial frame */
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
