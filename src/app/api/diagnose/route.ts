import { requireAuth } from "@/lib/server/auth";
import { crossrefSearch } from "@/lib/server/crossref";
import { S, parseJson } from "@/lib/server/gemini";
import { DEFAULT_CHAT_MODEL, DEFAULT_TRANSLATE_MODEL, llmErrorPayload, llmGenerate, parseModel, providerAvailable } from "@/lib/server/llm";
import { getWork, hasOpenAlex, listWorks } from "@/lib/server/openalex";

export const maxDuration = 60;

interface Check {
  name: string;
  ok: boolean;
  ms: number;
  detail: string;
}

async function time(name: string, fn: () => Promise<string>): Promise<Check> {
  const t = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Date.now() - t, detail };
  } catch (e) {
    const p = llmErrorPayload(e);
    const hint =
      p.status === 429 ? (p.perDay ? "（今日免費額度已用完）" : `（每分鐘上限，${p.retryAfter ?? "?"} 秒後可再試）`) : p.status === 404 ? "（模型名稱不存在）" : "";
    return { name, ok: false, ms: Date.now() - t, detail: `${p.error}${hint}` };
  }
}

async function tryModel(spec: string) {
  const { provider } = parseModel(spec, DEFAULT_TRANSLATE_MODEL);
  if (!providerAvailable(provider)) throw new Error(`${provider} 的 API key 未設定`);
  const { text, model } = await llmGenerate({
    model: spec,
    defaultModel: DEFAULT_TRANSLATE_MODEL,
    system: "Translate the sentence into Traditional Chinese. Reply as JSON with keys id and t.",
    contents: [{ role: "user", parts: [{ text: '{"id":"1.1","text":"Recovery is positively related to work engagement."}' }] }],
    schema: S.obj({ id: S.str(), t: S.str() }),
    json: true,
    thinking: "low",
  });
  const r = parseJson<{ t?: string }>(text);
  return `${r.t ?? text.slice(0, 60)}（${model}）`;
}

/** Live end-to-end checks of every external service, for the Settings page. */
export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { translate, chat } = (await req.json().catch(() => ({}))) as { translate?: string; chat?: string };
  const tSpec = parseModel(translate, DEFAULT_TRANSLATE_MODEL).spec;
  const cSpec = parseModel(chat, DEFAULT_CHAT_MODEL).spec;
  const checks = await Promise.all([
    time(`翻譯模型 ${tSpec}`, () => tryModel(tSpec)),
    time(`解釋與討論模型 ${cSpec}`, () => tryModel(cSpec)),
    time("OpenAlex 書目查詢", async () => {
      if (!hasOpenAlex()) throw new Error("OPENALEX_API_KEY 未設定");
      const w = await getWork({ doi: "10.1509/jmkg.73.2.70" });
      if (!w) throw new Error("查無資料（金鑰可能無效）");
      return w.display_name ?? "ok";
    }),
    time("OpenAlex 搜尋", async () => {
      if (!hasOpenAlex()) throw new Error("OPENALEX_API_KEY 未設定");
      const l = await listWorks({ search: "consumer company identification", perPage: 1 });
      return `${l.length} 筆：${l[0]?.display_name ?? ""}`;
    }),
    time("Crossref", async () => {
      const l = await crossrefSearch({ title: "Proactive Postsales Service: When and Why Does It Pay Off?" });
      return l[0]?.DOI ?? "無結果";
    }),
  ]);
  return Response.json({ checks, at: new Date().toISOString() });
}
