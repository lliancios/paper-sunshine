import type { GuideRequest, OverviewRequest, QuizRequest, RerankRequest, StreamRequest, TranslateLinesRequest, TranslateRequest } from "../apiTypes";
import { S } from "./gemini";

// House style for everything the app writes in Chinese.
const STYLE = "用語：一律使用「訊息」，不使用「信息」、「口徑」；不要使用破折號；使用台灣繁體中文學術用語。";

function fillLang(prompt: string, lang: string) {
  return prompt.replaceAll("{targetLanguage}", lang);
}

// ------------------------------------------------------------ translate ----

export function translatePrompt(r: TranslateRequest) {
  const cats = r.categories.map((c) => `${c.key}＝${c.label}（${c.description}）`).join("；");
  const rules = [
    "【系統輸出規則（優先於以上所有規則，確保雙語高亮能逐句對齊）】",
    '1. 輸入是 JSON：{"paper_title","glossary":[{"en","zh"}],"blocks":[{"kind","sentences":[{"id","text","first_terms"?}]}]}。',
    "2. 每一個 sentence 都要輸出一筆，id 原樣帶回、順序不變。不可遺漏、合併或拆分句子；同一句之內可依中文語序重組。",
    `3. t：該句的${r.targetLanguage}翻譯。術語一律依 glossary 的譯法。只有帶 first_terms 的句子，譯文中對應術語使用「English（中文）」格式；其他句子只用中文術語（縮寫如 PPS、H1 可保留）。`,
    "4. kind=heading 或 label 的譯文要簡短，保持標題或圖中標籤的性質；kind=caption 保留 Figure/Table 編號。",
    "5. 句子來自 PDF 抽取，可能有斷字、多餘空白或上下標殘留，請依語意翻譯，不要照抄亂碼。",
    `5b. t 只放${r.targetLanguage}譯文：不要先重抄英文原句，也不要英文與譯文並列（first_terms 的「English（中文）」術語格式除外）。`,
    r.autoHighlight
      ? `6. c：只對 kind=para 的句子判斷是否為論文關鍵句，分類為 ${cats}；非關鍵句或非 para 句填 "none"。請精選，一頁通常 2 到 6 句，只標真正關鍵、讀者會想劃線的句子。`
      : '6. c 一律填 "none"。',
    "7. 只輸出 JSON。",
  ].join("\n");
  const system = `${fillLang(r.rolePrompt, r.targetLanguage)}\n\n${rules}`;
  const user = JSON.stringify({ paper_title: r.paperTitle ?? "", glossary: r.glossary, blocks: r.blocks });
  const catKeys = [...r.categories.map((c) => c.key), "none"];
  const schema = S.obj({
    items: S.arr(S.obj({ id: S.str(), t: S.str(), c: S.enumOf(catKeys) })),
  });
  return { system, user, schema };
}

// ---------------------------------------------------------------- guide ----

/** Whole-paper pass: reading guide, glossary and all auto highlights in one request. */
const DENSITY = {
  low: "平均每頁 1 到 3 句，全篇約 10 到 30 句",
  normal: "平均每頁 2 到 5 句，全篇約 20 到 50 句",
  high: "平均每頁 4 到 8 句，全篇約 40 到 90 句",
} as const;

function highlightRule(r: GuideRequest, cats: string) {
  return [
    `highlights：從全文挑出讀者最該劃線的關鍵句，分類為 ${cats}。`,
    `數量：${DENSITY[r.density ?? "normal"]}。只挑真正承載論點、方法或發現的句子，寧缺勿濫。`,
    "分布：必須涵蓋全文各節（摘要、引言、理論與假設、方法、結果、討論與限制），不要集中在前幾頁；摘要最多 3 句，同一段最多 2 句。",
    "只能使用輸入中出現過的句子ID，不要挑標題、參考文獻、作者簡介、致謝或版權說明。",
  ].join("");
}

export function guidePrompt(r: GuideRequest) {
  const cats = r.categories.map((c) => `${c.key}＝${c.label}（${c.description}）`).join("；");
  const catKeys = r.categories.map((c) => c.key);
  const hlSchema = S.arr(S.obj({ id: S.str(), c: catKeys.length ? S.enumOf(catKeys) : S.str() }));
  if (r.highlightsOnly) {
    const system = [
      "你是學術研究助理。輸入是整篇論文，每行是「句子ID<Tab>句子」，標題行以 ## 開頭。輸出 JSON，只有 highlights 一個欄位：",
      highlightRule(r, cats),
      STYLE,
    ].join("\n");
    return { system, user: `論文標題：${r.title ?? "（未知）"}\n\n${r.lines}`, schema: S.obj({ highlights: hlSchema }) };
  }
  const system = [
    "你是學術研究助理。在翻譯整篇論文之前，一次完成導讀、術語表與關鍵句標記。",
    `以下是使用者的翻譯規範，術語的${r.targetLanguage}譯法必須遵守它：`,
    "-----",
    fillLang(r.rolePrompt, r.targetLanguage),
    "-----",
    "輸入是整篇論文，每行是「句子ID<Tab>句子」，標題行以 ## 開頭。輸出 JSON：",
    "titleZh：論文標題譯名。",
    "summary3：三句話摘要（研究問題、方法、主要發現），每句不超過 60 字。",
    `keywords：8 到 15 個最核心的構念、理論或方法詞：en、${r.targetLanguage}譯名 zh、在本文脈絡中的定義 def（不超過 60 字）。`,
    "glossary：15 到 60 個反覆出現的專有名詞、構念、變數與方法詞（含 keywords）的統一譯名。en 使用原文最常見寫法（保留大小寫與縮寫）。",
    r.autoHighlight ? highlightRule(r, cats) : "highlights：空陣列。",
    STYLE,
  ].join("\n");
  const user = `論文標題：${r.title ?? "（未知）"}\n\n${r.lines}`;
  const schema = S.obj({
    titleZh: S.str(),
    summary3: S.arr(S.str()),
    keywords: S.arr(S.obj({ en: S.str(), zh: S.str(), def: S.str() })),
    glossary: S.arr(S.obj({ en: S.str(), zh: S.str() })),
    highlights: hlSchema,
  });
  return { system, user, schema };
}

// ------------------------------------------------------ translate (lines) ----

/** Streamed multi-page translation; one "<id>\t<translation>" line per sentence. */
export function translateLinesPrompt(r: TranslateLinesRequest) {
  const rules = [
    "【系統輸出規則（優先於以上所有規則，確保雙語高亮能逐句對齊）】",
    '1. 輸入是 JSON：{"paper_title","glossary":[{"en","zh"}],"blocks":[{"kind","sentences":[{"id","text","first_terms"?}]}]}。',
    "2. 逐句翻譯，每一句輸出一行：句子ID、一個 Tab、譯文。依輸入順序，不可遺漏、合併或拆分句子；同一句之內可依中文語序重組。",
    "3. 譯文本身不得換行；不得輸出任何其他文字、標題、Markdown、程式碼區塊或說明。",
    `4. 譯文使用${r.targetLanguage}。術語一律依 glossary；只有帶 first_terms 的句子，對應術語使用「English（中文）」格式，其他句子只用中文術語（縮寫如 PPS、H1 可保留）。`,
    "5. kind=heading 或 label 的譯文要簡短；kind=caption 保留 Figure/Table 編號。",
    "6. 句子來自 PDF 抽取，可能有斷字、多餘空白或上下標殘留，請依語意翻譯。",
    `7. 每一行只放${r.targetLanguage}譯文：不要先重抄英文原句，也不要英文與譯文並列（first_terms 的「English（中文）」術語格式除外）。表格儲存格、條列項目與短標籤同樣要翻譯。`,
  ].join("\n");
  const system = `${fillLang(r.rolePrompt, r.targetLanguage)}\n\n${rules}`;
  const user = JSON.stringify({ paper_title: r.paperTitle ?? "", glossary: r.glossary, blocks: r.blocks });
  return { system, user };
}

// ------------------------------------------------------------- overview ----

export function overviewPrompt(r: OverviewRequest) {
  const system = [
    "你是學術研究助理，負責在翻譯整篇論文之前建立術語表與導讀。",
    `以下是使用者的翻譯規範，術語的${r.targetLanguage}譯法必須遵守它：`,
    "-----",
    fillLang(r.rolePrompt, r.targetLanguage),
    "-----",
    "任務：閱讀論文文字，輸出 JSON：",
    "titleZh：論文標題的譯名。",
    "summary3：三句話摘要（研究問題、方法、主要發現），每句不超過 60 字。",
    `keywords：8 到 15 個本文最核心的構念、理論或方法詞，含英文 en、${r.targetLanguage}譯名 zh、在本文脈絡中的定義 def（不超過 60 字）。`,
    "glossary：15 到 60 個本文反覆出現的專有名詞、構念、變數與方法詞（含 keywords），給出全文統一的譯名。en 使用原文最常見的寫法（保留大小寫與縮寫，例如 Proactive postsales service, PPS）。",
    STYLE,
  ].join("\n");
  const user = `論文標題：${r.title ?? "（未知）"}\n\n論文內容：\n${r.text}`;
  const schema = S.obj({
    titleZh: S.str(),
    summary3: S.arr(S.str()),
    keywords: S.arr(S.obj({ en: S.str(), zh: S.str(), def: S.str() })),
    glossary: S.arr(S.obj({ en: S.str(), zh: S.str() })),
  });
  return { system, user, schema };
}

// ----------------------------------------------------------------- quiz ----

export function quizPrompt(r: QuizRequest) {
  const system = [
    "你是研究所課程助教。根據論文內容出 5 題單選題，檢驗讀者是否真正理解研究問題、理論、方法、發現與限制。",
    "每題：q 為繁體中文題目，qEn 為英文題目，options 為 4 個選項（每個選項格式「中文 / English」），answer 為正確選項索引（0 到 3），explain 為雙語解析（先中文再英文）。",
    "干擾選項要合理，不能一眼看出錯誤。",
    STYLE,
  ].join("\n");
  const user = `論文標題：${r.title ?? ""}\n\n${r.text}`;
  const schema = S.obj({
    questions: S.arr(S.obj({ q: S.str(), qEn: S.str(), options: S.arr(S.str()), answer: S.int(), explain: S.str() })),
  });
  return { system, user, schema };
}

// --------------------------------------------------------------- rerank ----

export function rerankPrompt(r: RerankRequest) {
  const system = [
    "你是熟悉行銷、品牌、服務與組織行為研究的文獻顧問。",
    "依據「使用者的研究脈絡」與「正在閱讀的論文」，評估每篇候選文獻對使用者的參考價值（0 到 100）。",
    "重點是構念層次的關聯（相同或相鄰的理論構念、可借用的架構或方法），不是表面字詞相同。例如 consumer 出現在計算機論文中不代表相關。",
    "reason：一句繁體中文說明為什麼值得讀（不超過 40 字），具體指出關聯的構念或用途。",
    STYLE,
  ].join("\n");
  const user = JSON.stringify({ research_context: r.researchContext, current_paper: r.paper, candidates: r.candidates });
  const schema = S.obj({ items: S.arr(S.obj({ id: S.str(), score: S.int(), reason: S.str() })) });
  return { system, user, schema };
}

// ------------------------------------------------------------- streaming ----

export function streamPrompt(r: StreamRequest): { system: string; user: string } {
  const lang = r.targetLanguage || "繁體中文（台灣）";
  const paper = [
    r.paperTitle ? `論文標題：${r.paperTitle}` : "",
    r.overview ? `論文導讀：\n${r.overview}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const research = r.researchContext
    ? `使用者的研究脈絡（只在確實相關時才連結，不要牽強）：\n${r.researchContext}`
    : "";
  const base = `你是使用者的研究夥伴，熟悉行銷、品牌、服務與組織行為研究。一律以${lang}回答，使用 Markdown，精簡清楚，不要客套話。${STYLE}`;

  switch (r.task) {
    case "explain":
      return {
        system: [base, paper, research].filter(Boolean).join("\n\n"),
        user: [
          r.context ? `所在段落（原文）：\n${r.context}` : "",
          `請解釋讀者選取的${r.side === "tgt" ? "譯文" : "原文"}片段：「${r.selection ?? ""}」`,
          "格式：先用一兩句白話說明意思；再說明其中的關鍵概念；最後一句說明它在本文論證中的角色。總長度盡量在 250 字內。",
        ]
          .filter(Boolean)
          .join("\n\n"),
      };
    case "figure":
      return {
        system: [base, paper].filter(Boolean).join("\n\n"),
        user: [
          r.caption ? `圖表標題：${r.caption}` : "",
          "請解讀這張圖或表：它呈現什麼、怎麼讀（軸、符號、線條、數字的意思）、最重要的兩三個重點。若是表格，指出關鍵數值與顯著性。",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    case "model":
      return {
        system: [base, paper, research].filter(Boolean).join("\n\n"),
        user: [
          r.caption ? `圖表標題：${r.caption}` : "",
          "請做「研究概念模型分析」：",
          "1. 用表格列出所有構念，欄位：構念（英文與中文）｜角色（自變數、依變數、中介、調節、控制）｜分析層次。",
          "2. 列出每條路徑與假設方向（實線、虛線各代表什麼），標出假設編號（若可辨識）。",
          "3. 用一句話說明整個模型的核心邏輯。",
          "4. 若與使用者的研究脈絡有可借用之處，最後用兩三點說明（沒有就省略）。",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    case "onepager":
      return {
        system: [base, research].filter(Boolean).join("\n\n"),
        user: [
          paper,
          "論文全文（每行「句子ID<Tab>句子」，標題行以 ## 開頭）：",
          r.paperText ?? "",
          "請做「一頁速覽」，讓讀者在精讀前 3 分鐘掌握全文。規則：",
          "· 每個事實性陳述後面用 [[句子ID]] 標出依據（例如 [[3.12]]），一個陳述最多 3 個依據，寫成 [[3.12]][[4.2]]；只能用輸入中出現的ID；論文沒寫的就寫「論文未說明」，不可推測。",
          "· 使用以下 Markdown 段落標題，順序固定，整體精簡：",
          "## 一句話結論",
          "## 論文身分證（表格：類型｜研究情境｜分析層次｜樣本與資料｜方法）",
          "## 研究問題與缺口",
          "## 理論與核心構念（表格：構念（英文／中文）｜角色（自變數、依變數、中介、調節、控制、概念）｜本文定義）",
          "## 研究設計",
          "## 主要發現（逐條，註明支持或不支持）",
          "## 貢獻（理論／實務）",
          "## 限制與未來研究",
          "## 五 C 快速評估（Category、Context、Correctness、Contributions、Clarity 各一句）",
          "## 與我的研究的關聯（沒有明確關聯就寫「無明確關聯」）",
          "## 值得引用的三句（引用英文原句，後附 [[句子ID]]）",
          "## 精讀路線（第二遍該讀哪些段落、可略讀哪些，附 [[句子ID]]）",
        ].join("\n"),
      };
    case "summary":
      return {
        system: [base, research].filter(Boolean).join("\n\n"),
        user: [
          paper,
          `論文全文：\n${r.paperText ?? ""}`,
          "請寫詳細摘要，段落標題依序為：研究問題、理論基礎、研究設計、主要發現、理論與實務貢獻、研究限制、與我的研究的關聯（沒有明確關聯就寫「無明確關聯」）。每段 2 到 4 點。",
        ].join("\n\n"),
      };
    case "chat":
    default:
      return {
        system: [
          base,
          [
            "你正在陪使用者讀一篇論文，但使用者可以問任何問題（這篇論文、研究方法、統計、理論、寫作、翻譯或一般知識），都要直接回答。",
            "論文全文附在下面，每行是「句子ID<Tab>句子」。回答用到論文內容時，在該句句末用 [[句子ID]] 標出依據（一個論點最多 3 個，寫成 [[3.12]][[4.2]]），只能用全文中出現的ID。",
            "超出論文的部分用你的專業知識回答，並在該段開頭標明「（非出自本文）」；論文沒有寫的事不可說成論文寫的。",
          ].join("\n"),
          research,
          paper,
          `論文全文：\n${r.paperText ?? ""}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        user: "",
      };
  }
}
