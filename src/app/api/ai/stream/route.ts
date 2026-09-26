import type { StreamRequest } from "@/lib/apiTypes";
import { requireAuth } from "@/lib/server/auth";
import type { Content } from "@/lib/server/gemini";
import { DEFAULT_CHAT_MODEL, DEFAULT_TRANSLATE_MODEL, LlmError, canServe, llmErrorPayload, llmStream } from "@/lib/server/llm";
import { mockStream } from "@/lib/server/mock";
import { streamPrompt } from "@/lib/server/prompts";

export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = (await req.json()) as StreamRequest;
  const headers = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" };
  if (!canServe(body.model, DEFAULT_CHAT_MODEL) && !canServe(undefined, DEFAULT_TRANSLATE_MODEL)) return new Response(mockStream(body.task), { headers });
  const { system, user } = streamPrompt(body);
  const contents: Content[] = [];
  if (body.task === "chat") {
    for (const m of body.messages ?? []) contents.push({ role: m.role, parts: [{ text: m.text }] });
    if (!contents.length) return Response.json({ error: "empty chat" }, { status: 400 });
  } else {
    const parts: Content["parts"] = [];
    if (body.image) parts.push({ inlineData: { mimeType: "image/jpeg", data: body.image } });
    parts.push({ text: user });
    contents.push({ role: "user", parts });
  }
  try {
    const { stream, model } = await llmStream({
      model: body.model,
      defaultModel: DEFAULT_CHAT_MODEL,
      fallback: DEFAULT_TRANSLATE_MODEL, // daily quota on Flash → continue on Flash-Lite
      system,
      contents,
      thinking: body.task === "summary" || body.task === "model" || body.task === "onepager" ? "medium" : "low",
    });
    return new Response(stream, { headers: { ...headers, "x-model": model } });
  } catch (e) {
    const status = e instanceof LlmError && e.status >= 400 && e.status < 600 ? e.status : 500;
    return Response.json(llmErrorPayload(e), { status });
  }
}
