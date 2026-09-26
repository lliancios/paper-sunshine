import type { StreamRequest } from "@/lib/apiTypes";
import { requireAuth } from "@/lib/server/auth";
import { type Content, GeminiError, hasGemini, modelFor, streamText } from "@/lib/server/gemini";
import { mockStream } from "@/lib/server/mock";
import { streamPrompt } from "@/lib/server/prompts";

export const maxDuration = 120;

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = (await req.json()) as StreamRequest;
  const headers = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" };
  if (!hasGemini()) return new Response(mockStream(body.task), { headers });
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
    const stream = await streamText({
      model: modelFor("chat", body.model),
      system,
      contents,
      thinking: body.task === "summary" || body.task === "model" ? "medium" : "low",
    });
    return new Response(stream, { headers });
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500;
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: status >= 400 ? status : 500 });
  }
}
