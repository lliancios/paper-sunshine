import type { Guide, JsonTaskRequest, Overview, QuizQuestion, RerankItem, TranslateItem, TranslateResponse } from "@/lib/apiTypes";
import { requireAuth } from "@/lib/server/auth";
import { parseJson } from "@/lib/server/gemini";
import { DEFAULT_CHAT_MODEL, DEFAULT_TRANSLATE_MODEL, LlmError, canServe, llmErrorPayload, llmGenerate } from "@/lib/server/llm";
import { mockGuide, mockOverview, mockQuiz, mockTranslate } from "@/lib/server/mock";
import { guidePrompt, overviewPrompt, quizPrompt, rerankPrompt, translatePrompt } from "@/lib/server/prompts";

export const maxDuration = 300;

const user = (text: string) => [{ role: "user" as const, parts: [{ text }] }];

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  let body: JsonTaskRequest;
  try {
    body = (await req.json()) as JsonTaskRequest;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const t = { model: body.model, defaultModel: DEFAULT_TRANSLATE_MODEL, fallback: DEFAULT_TRANSLATE_MODEL };
  try {
    switch (body.task) {
      case "guide": {
        if (!canServe(body.model, DEFAULT_TRANSLATE_MODEL)) return Response.json(mockGuide(body));
        const p = guidePrompt(body);
        const { text, model } = await llmGenerate({ ...t, system: p.system, contents: user(p.user), schema: p.schema, json: true, thinking: "low", maxOutputTokens: 16384 });
        const g = parseJson<Guide>(text);
        const valid = new Set(body.categories.map((c) => c.key));
        return Response.json({
          titleZh: g.titleZh ?? "",
          summary3: (g.summary3 ?? []).slice(0, 3),
          keywords: (g.keywords ?? []).filter((k) => k?.en && k?.zh),
          glossary: (g.glossary ?? []).filter((x) => x?.en && x?.zh),
          highlights: (g.highlights ?? []).filter((h) => h?.id && valid.has(h.c)),
          model,
        });
      }
      case "translate": {
        if (!canServe(body.model, DEFAULT_TRANSLATE_MODEL)) return Response.json(mockTranslate(body));
        const p = translatePrompt(body);
        const { text, model } = await llmGenerate({ ...t, system: p.system, contents: user(p.user), schema: p.schema, json: true, thinking: "low" });
        const parsed = parseJson<{ items?: TranslateItem[] } | TranslateItem[]>(text);
        const list = Array.isArray(parsed) ? parsed : parsed.items ?? [];
        const valid = new Set(body.categories.map((c) => c.key));
        const items = list.filter((x) => x && typeof x.id === "string").map((x) => ({ id: x.id, t: String(x.t ?? ""), c: x.c && valid.has(x.c) ? x.c : null }));
        return Response.json({ items, model } satisfies TranslateResponse);
      }
      case "overview": {
        if (!canServe(body.model, DEFAULT_TRANSLATE_MODEL)) return Response.json(mockOverview(body.title));
        const p = overviewPrompt(body);
        const { text } = await llmGenerate({ ...t, system: p.system, contents: user(p.user), schema: p.schema, json: true, thinking: "low" });
        const o = parseJson<Overview>(text);
        return Response.json({
          titleZh: o.titleZh ?? "",
          summary3: (o.summary3 ?? []).slice(0, 3),
          keywords: (o.keywords ?? []).filter((k) => k?.en && k?.zh),
          glossary: (o.glossary ?? []).filter((g) => g?.en && g?.zh),
        } satisfies Overview);
      }
      case "quiz": {
        if (!canServe(body.model, DEFAULT_CHAT_MODEL)) return Response.json({ questions: mockQuiz(), mock: true });
        const p = quizPrompt(body);
        const { text } = await llmGenerate({ model: body.model, defaultModel: DEFAULT_CHAT_MODEL, fallback: DEFAULT_TRANSLATE_MODEL, system: p.system, contents: user(p.user), schema: p.schema, json: true, thinking: "medium" });
        const q = parseJson<{ questions?: QuizQuestion[] }>(text);
        const questions = (q.questions ?? []).filter((x) => x.options?.length >= 2 && x.answer >= 0 && x.answer < x.options.length);
        return Response.json({ questions });
      }
      case "rerank": {
        if (!canServe(body.model, DEFAULT_TRANSLATE_MODEL)) return Response.json({ items: [], mock: true });
        const p = rerankPrompt(body);
        const { text } = await llmGenerate({ ...t, system: p.system, contents: user(p.user), schema: p.schema, json: true, thinking: "low" });
        return Response.json({ items: parseJson<{ items?: RerankItem[] }>(text).items ?? [] });
      }
      default:
        return Response.json({ error: "unknown task" }, { status: 400 });
    }
  } catch (e) {
    const p = llmErrorPayload(e);
    const status = e instanceof LlmError && e.status >= 400 && e.status < 600 ? e.status : 500;
    return Response.json(p, { status });
  }
}
