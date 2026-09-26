import type { TranslateLinesRequest } from "@/lib/apiTypes";
import { requireAuth } from "@/lib/server/auth";
import { DEFAULT_TRANSLATE_MODEL, LlmError, canServe, llmErrorPayload, llmStream } from "@/lib/server/llm";
import { mockLines } from "@/lib/server/mock";
import { translateLinesPrompt } from "@/lib/server/prompts";

export const maxDuration = 300;

/** Streams "<sid>\t<translation>" lines for several pages in a single model call. */
export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = (await req.json()) as TranslateLinesRequest;
  const headers = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" };
  if (!canServe(body.model, DEFAULT_TRANSLATE_MODEL)) return new Response(mockLines(body), { headers: { ...headers, "x-mock": "1" } });
  const p = translateLinesPrompt(body);
  try {
    const { stream, model } = await llmStream({
      model: body.model,
      defaultModel: DEFAULT_TRANSLATE_MODEL,
      fallback: DEFAULT_TRANSLATE_MODEL,
      system: p.system,
      contents: [{ role: "user", parts: [{ text: p.user }] }],
      thinking: "low",
      maxOutputTokens: 32768,
    });
    return new Response(stream, { headers: { ...headers, "x-model": model } });
  } catch (e) {
    const status = e instanceof LlmError && e.status >= 400 && e.status < 600 ? e.status : 500;
    return Response.json(llmErrorPayload(e), { status });
  }
}
