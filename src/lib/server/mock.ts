// Demo responses used when GEMINI_API_KEY is not configured, so the whole app
// (sync highlights, overlays, panels) can be tried before adding a key.
import type { Guide, GuideRequest, Overview, QuizQuestion, TranslateLinesRequest, TranslateRequest, TranslateResponse } from "../apiTypes";

export function mockTranslate(r: TranslateRequest): TranslateResponse {
  const items = [];
  let n = 0;
  for (const b of r.blocks) {
    for (const s of b.sentences) {
      n++;
      const cat =
        r.autoHighlight && b.kind === "para" && n % 6 === 2 ? r.categories[(n / 6) % r.categories.length | 0]?.key ?? null : null;
      items.push({ id: s.id, t: process.env.MOCK_STYLE === "zh" ? fakeZh(s.text) : `〔示範譯文〕${s.text}`, c: cat });
    }
  }
  return { items, mock: true, model: "mock" };
}

export function mockOverview(title?: string): Overview {
  return {
    titleZh: title ? `〔示範〕${title}` : "〔示範標題〕",
    summary3: [
      "目前是示範模式：伺服器尚未設定 GEMINI_API_KEY。",
      "在 Vercel 的環境變數加入 GEMINI_API_KEY 後重新部署，就會產生真正的翻譯與摘要。",
      "設定完成後，可在論文資訊中按「重新翻譯」。",
    ],
    keywords: [{ en: "Demo mode", zh: "示範模式", def: "尚未設定 Gemini API key 時的假資料。" }],
    glossary: [],
    mock: true,
  };
}

export function mockQuiz(): QuizQuestion[] {
  return [
    {
      q: "目前的測驗為什麼是示範內容？",
      qEn: "Why is this quiz a demo?",
      options: ["伺服器尚未設定 GEMINI_API_KEY / No Gemini key on the server", "論文太短 / The paper is too short", "網路中斷 / Network is down", "瀏覽器不支援 / Unsupported browser"],
      answer: 0,
      explain: "設定 GEMINI_API_KEY 後即可產生真正的題目。 / Add GEMINI_API_KEY to generate real questions.",
    },
  ];
}

export function mockStream(task: string): ReadableStream<Uint8Array> {
  const text = `**示範模式**\n\n伺服器尚未設定 \`GEMINI_API_KEY\`，所以這裡顯示的是假資料（任務：${task}）。\n\n到 Vercel 專案的 Settings → Environment Variables 加入金鑰並重新部署後，就會出現真正的 AI 回答。`;
  const enc = new TextEncoder();
  const chunks = text.match(/.{1,12}/gs) ?? [text];
  let i = 0;
  return new ReadableStream({
    async pull(c) {
      if (i >= chunks.length) return c.close();
      await new Promise((r) => setTimeout(r, 25));
      c.enqueue(enc.encode(chunks[i++]));
    },
  });
}

// Chinese-shaped filler (about 0.4 chars per English char) for layout testing.
const FILL = "本研究探討休閒時間的恢復如何影響隔日工作投入與主動行為並以多層次分析檢驗每日資料顯示恢復與投入之間存在顯著正向關係";
function fakeZh(en: string): string {
  const n = Math.max(4, Math.round(en.length * 0.4));
  let out = "";
  for (let i = 0; out.length < n; i++) out += FILL[(en.length + i) % FILL.length];
  return `${out}。`;
}

export function mockGuide(r: GuideRequest): Guide {
  const ids = r.lines
    .split("\n")
    .map((l) => l.split("\t")[0])
    .filter((x) => /^\d+\.\d+$/.test(x));
  const highlights = r.autoHighlight
    ? ids.filter((_, i) => i % ({ low: 14, normal: 9, high: 5 }[r.density ?? "normal"]) === 3).map((id, i) => ({ id, c: r.categories[i % Math.max(1, r.categories.length)]?.key ?? "novelty" }))
    : [];
  return { ...mockOverview(r.title), highlights };
}

/** MOCK_STYLE=echo imitates a model that repeats the English before its translation. */
function mockLine(text: string): string {
  if (process.env.MOCK_STYLE === "echo") return `${text} ${fakeZh(text)}`;
  return process.env.MOCK_STYLE === "zh" ? fakeZh(text) : `〔示範譯文〕${text}`;
}

export function mockLines(r: TranslateLinesRequest): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const lines = r.blocks.flatMap((b) => b.sentences.map((s) => `${s.id}\t${mockLine(s.text)}\n`));
  let i = 0;
  return new ReadableStream({
    async pull(c) {
      if (i >= lines.length) return c.close();
      await new Promise((res) => setTimeout(res, 15));
      c.enqueue(enc.encode(lines.slice(i, i + 3).join("")));
      i += 3;
    },
  });
}
