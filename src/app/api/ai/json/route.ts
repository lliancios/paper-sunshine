import type { JsonTaskRequest, Overview, QuizQuestion, RerankItem, TranslateItem, TranslateResponse } from "@/lib/apiTypes";
import { requireAuth } from "@/lib/server/auth";
import { GeminiError, generate, hasGemini, modelFor, parseJson } from "@/lib/server/gemini";
import { mockOverview, mockQuiz, mockTranslate } from "@/lib/server/mock";
import { overviewPrompt, quizPrompt, rerankPrompt, translatePrompt } from "@/lib/server/prompts";

export const maxDuration = 120;

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  let body: JsonTaskRequest;
  try {
    body = (await req.json()) as JsonTaskRequest;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  try {
    switch (body.task) {
      case "translate": {
        if (!hasGemini()) return Response.json(mockTranslate(body));
        const model = modelFor("translate", body.model);
        const { system, user, schema } = translatePrompt(body);
        const { text } = await generate({ model, system, contents: [{ role: "user", parts: [{ text: user }] }], schema, json: true, thinking: "low" });
        const parsed = parseJson<{ items?: TranslateItem[] } | TranslateItem[]>(text);
        const list = Array.isArray(parsed) ? parsed : parsed.items ?? [];
        const valid = new Set(body.categories.map((c) => c.key));
        const items = list
          .filter((x) => x && typeof x.id === "string")
          .map((x) => ({ id: x.id, t: String(x.t ?? ""), c: x.c && valid.has(x.c) ? x.c : null }));
        const res: TranslateResponse = { items, model };
        return Response.json(res);
      }
      case "overview": {
        if (!hasGemini()) return Response.json(mockOverview(body.title));
        const model = modelFor("translate", body.model);
        const { system, user, schema } = overviewPrompt(body);
        const { text } = await generate({ model, system, contents: [{ role: "user", parts: [{ text: user }] }], schema, json: true, thinking: "low" });
        const o = parseJson<Overview>(text);
        return Response.json({
          titleZh: o.titleZh ?? "",
          summary3: (o.summary3 ?? []).slice(0, 3),
          keywords: (o.keywords ?? []).filter((k) => k?.en && k?.zh),
          glossary: (o.glossary ?? []).filter((g) => g?.en && g?.zh),
        } satisfies Overview);
      }
      case "quiz": {
        if (!hasGemini()) return Response.json({ questions: mockQuiz(), mock: true });
        const model = modelFor("chat", body.model);
        const { system, user, schema } = quizPrompt(body);
        const { text } = await generate({ model, system, contents: [{ role: "user", parts: [{ text: user }] }], schema, json: true, thinking: "medium" });
        const q = parseJson<{ questions?: QuizQuestion[] }>(text);
        const questions = (q.questions ?? []).filter((x) => x.options?.length >= 2 && x.answer >= 0 && x.answer < x.options.length);
        return Response.json({ questions });
      }
      case "rerank": {
        if (!hasGemini()) return Response.json({ items: [], mock: true });
        const model = modelFor("translate", body.model);
        const { system, user, schema } = rerankPrompt(body);
        const { text } = await generate({ model, system, contents: [{ role: "user", parts: [{ text: user }] }], schema, json: true, thinking: "low" });
        const r = parseJson<{ items?: RerankItem[] }>(text);
        return Response.json({ items: r.items ?? [] });
      }
      default:
        return Response.json({ error: "unknown task" }, { status: 400 });
    }
  } catch (e) {
    const status = e instanceof GeminiError ? e.status : 500;
    return Response.json({ error: String(e instanceof Error ? e.message : e) }, { status: status >= 400 ? status : 500 });
  }
}
