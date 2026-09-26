// One entry point for every model call. Model specs look like
// "gemini:gemini-3.5-flash-lite" or "deepseek:deepseek-flash"; a spec without
// a prefix is treated as Gemini for backward compatibility.
import { type Content, GeminiError, generate as gGenerate, hasGemini, streamText as gStream } from "./gemini";
import { type OaiProvider, OaiError, oaiAvailable, oaiGenerate, oaiStream } from "./openai";

export type Provider = "gemini" | OaiProvider;
export const PROVIDERS: Provider[] = ["gemini", "deepseek", "openrouter", "siliconflow", "groq", "custom"];

export const DEFAULT_TRANSLATE_MODEL = "gemini:gemini-3.5-flash-lite";
export const DEFAULT_CHAT_MODEL = "gemini:gemini-3.8-flash";

export function parseModel(spec: string | undefined, fallback: string): { provider: Provider; model: string; spec: string } {
  let s = (spec ?? "").trim();
  if (!s || !/^[a-z0-9][\w.\-:/@]{2,100}$/i.test(s)) s = fallback;
  const i = s.indexOf(":");
  const maybe = i > 0 ? s.slice(0, i) : "";
  if ((PROVIDERS as string[]).includes(maybe)) return { provider: maybe as Provider, model: s.slice(i + 1), spec: s };
  return { provider: "gemini", model: s, spec: `gemini:${s}` };
}

export function providerAvailable(p: Provider): boolean {
  return p === "gemini" ? hasGemini() : oaiAvailable(p);
}

export function availableProviders(): Record<Provider, boolean> {
  return Object.fromEntries(PROVIDERS.map((p) => [p, providerAvailable(p)])) as Record<Provider, boolean>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number,
    public perDay?: boolean,
    public model?: string,
  ) {
    super(message);
  }
}

function normalize(e: unknown, spec: string): LlmError {
  if (e instanceof LlmError) return e;
  if (e instanceof GeminiError) return new LlmError(e.message, e.status, e.retryAfter, !!e.quota && /PerDay/i.test(e.quota), spec);
  if (e instanceof OaiError) return new LlmError(e.message, e.status, e.retryAfter, e.perDay, spec);
  return new LlmError(e instanceof Error ? e.message : String(e), 500, undefined, false, spec);
}

export interface LlmOptions {
  model?: string; // spec requested by the client
  defaultModel: string;
  fallback?: string; // used once when the first model hits its daily quota or is unavailable
  system: string;
  contents: Content[];
  json?: boolean;
  schema?: unknown;
  thinking?: "low" | "medium" | "high";
  maxOutputTokens?: number;
}

function shouldFallback(e: LlmError) {
  return (e.status === 429 && e.perDay) || e.status === 404 || e.status === 403 || /未設定/.test(e.message);
}

async function once(spec: string, o: LlmOptions): Promise<string> {
  const { provider, model } = parseModel(spec, o.defaultModel);
  if (provider === "gemini") {
    const { text } = await gGenerate({ model, system: o.system, contents: o.contents, schema: o.schema, json: o.json, thinking: o.thinking, maxOutputTokens: o.maxOutputTokens });
    return text;
  }
  const sys = o.json && o.schema ? `${o.system}\n\n只輸出符合此 JSON Schema 的 JSON：\n${JSON.stringify(o.schema)}` : o.system;
  return oaiGenerate({ provider, model, system: sys, contents: o.contents, json: o.json, maxOutputTokens: o.maxOutputTokens });
}

async function onceStream(spec: string, o: LlmOptions): Promise<ReadableStream<Uint8Array>> {
  const { provider, model } = parseModel(spec, o.defaultModel);
  if (provider === "gemini") return gStream({ model, system: o.system, contents: o.contents, thinking: o.thinking, maxOutputTokens: o.maxOutputTokens });
  return oaiStream({ provider, model, system: o.system, contents: o.contents, maxOutputTokens: o.maxOutputTokens });
}

export async function llmGenerate(o: LlmOptions): Promise<{ text: string; model: string }> {
  const first = parseModel(o.model, o.defaultModel).spec;
  try {
    return { text: await once(first, o), model: first };
  } catch (e) {
    const err = normalize(e, first);
    const fb = o.fallback ? parseModel(o.fallback, o.defaultModel).spec : undefined;
    if (fb && fb !== first && shouldFallback(err)) {
      try {
        return { text: await once(fb, o), model: fb };
      } catch (e2) {
        throw normalize(e2, fb);
      }
    }
    throw err;
  }
}

export async function llmStream(o: LlmOptions): Promise<{ stream: ReadableStream<Uint8Array>; model: string }> {
  const first = parseModel(o.model, o.defaultModel).spec;
  try {
    return { stream: await onceStream(first, o), model: first };
  } catch (e) {
    const err = normalize(e, first);
    const fb = o.fallback ? parseModel(o.fallback, o.defaultModel).spec : undefined;
    if (fb && fb !== first && shouldFallback(err)) {
      try {
        return { stream: await onceStream(fb, o), model: fb };
      } catch (e2) {
        throw normalize(e2, fb);
      }
    }
    throw err;
  }
}

export function llmErrorPayload(e: unknown) {
  const err = normalize(e, "");
  return { error: err.message, status: err.status, retryAfter: err.retryAfter, perDay: err.perDay, model: err.model };
}

/** Whether any provider can serve the requested model spec (else the app runs in demo mode). */
export function canServe(spec: string | undefined, fallback: string): boolean {
  return providerAvailable(parseModel(spec, fallback).provider);
}
