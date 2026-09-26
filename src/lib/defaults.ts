// Defaults shown in Settings. Everything here can be edited in the app.

export interface Category {
  key: string;
  label: string;
  description: string;
  color: string; // hex
}

export const DEFAULT_CATEGORIES: Category[] = [
  { key: "novelty", label: "創新性", description: "本研究的創新、貢獻或與既有研究的差異", color: "#f43f5e" },
  { key: "method", label: "方法", description: "研究設計、樣本、資料蒐集、測量與分析方法", color: "#10b981" },
  { key: "result", label: "結果", description: "實證發現、檢定結果與主要結論", color: "#8b5cf6" },
  { key: "gap", label: "研究缺口", description: "既有文獻不足之處、研究動機與研究問題", color: "#f59e0b" },
  { key: "limitation", label: "限制", description: "研究限制與未來研究方向", color: "#0ea5e9" },
];

export const HIGHLIGHT_COLORS: { key: string; label: string; color: string }[] = [
  { key: "yellow", label: "黃", color: "#facc15" },
  { key: "green", label: "綠", color: "#4ade80" },
  { key: "blue", label: "藍", color: "#60a5fa" },
  { key: "pink", label: "粉", color: "#f472b6" },
  { key: "purple", label: "紫", color: "#a78bfa" },
];

export type ColorScheme = "basic" | "deep" | "stroke";
export const COLOR_SCHEMES: { key: ColorScheme; label: string; hint: string }[] = [
  { key: "basic", label: "Sunshine Basic", hint: "淡色底" },
  { key: "deep", label: "Deep Spread", hint: "深色底" },
  { key: "stroke", label: "Point Stroke", hint: "底線" },
];

/** "provider:model". Translation runs on Flash-Lite (about 500 free requests/day); chat on Flash (about 20/day, falls back to Flash-Lite). */
export const DEFAULT_MODELS = { translate: "gemini:gemini-3.5-flash-lite", chat: "gemini:gemini-3.8-flash" };

export interface ModelPreset {
  key: string;
  label: string;
  hint: string;
  translate: string;
  chat: string;
  needs: string; // env var the preset needs on the server
}
export const MODEL_PRESETS: ModelPreset[] = [
  { key: "gemini-free", label: "Gemini 免費方案", hint: "翻譯用 Flash-Lite（每日約 500 次），解釋用 Flash（每日約 20 次，用完自動改用 Flash-Lite）", translate: "gemini:gemini-3.5-flash-lite", chat: "gemini:gemini-3.8-flash", needs: "GEMINI_API_KEY" },
  { key: "gemini-paid", label: "Gemini 付費（品質最好）", hint: "Google 帳單啟用後，全部用 Flash；一篇論文約 0.02 到 0.1 美元", translate: "gemini:gemini-3.8-flash", chat: "gemini:gemini-3.8-flash", needs: "GEMINI_API_KEY" },
  { key: "deepseek", label: "DeepSeek（最便宜）", hint: "deepseek-flash，一篇論文約 0.01 到 0.05 美元，支援圖片", translate: "deepseek:deepseek-flash", chat: "deepseek:deepseek-flash", needs: "DEEPSEEK_API_KEY" },
  { key: "mixed", label: "DeepSeek 翻譯＋Gemini 解釋", hint: "大量翻譯交給 DeepSeek，解釋與圖表用 Gemini", translate: "deepseek:deepseek-flash", chat: "gemini:gemini-3.8-flash", needs: "DEEPSEEK_API_KEY + GEMINI_API_KEY" },
];

export const TARGET_LANGUAGES = ["繁體中文（台灣）", "简体中文", "English", "日本語", "한국어"];

export const DEFAULT_ROLE_PROMPT = `你是一名專精於行銷管理、品牌管理、服務行銷、消費者行為、組織行為與 Social Identity Theory（社會認同理論）的學術翻譯專家。

請將輸入內容忠實翻譯為 {targetLanguage}。

【研究背景】

目前閱讀的文獻主要服務於一項探索性研究：

「服務型品牌建構歷程中品牌創建者 Proactive Behavior（主動行為）之研究」

本研究特別關注兩條理論脈絡：

1. Proactive Behavior（主動行為）以及其在服務與品牌建構情境中的具體行動形式。
2. Consumer–Company Identification, C–C Identification（消費者—企業認同）及其所涉及的企業身分、身分吸引力、認同與消費者結果。

翻譯時請協助維持上述研究領域中的構念邊界，但不得為原文加入本研究沒有的理論解釋。

【核心翻譯原則】

1. 忠實翻譯原文，不擅自摘要、延伸、補充、評論、解釋或改寫作者論點。

2. 完整保留原文的理論邏輯，包括：前因 → 行為 → 心理機制 → 結果、因果關係、中介與調節關係、時間順序、比較關係、假設方向與研究命題。

3. 重要英文專有名詞、理論構念、模型名稱與研究變數，首次出現時使用「English term（繁體中文）」格式，例如 Proactive behavior（主動行為）、Proactive postsales service, PPS（主動售後服務）、Consumer–Company Identification, C–C Identification（消費者—企業認同）、Social Identity Theory（社會認同理論）。後續若英文名稱有助於避免構念混淆，可繼續保留英文或縮寫。

4. 嚴格區分不同但相近的構念，不得因中文名稱相似而合併，例如：Proactive behavior、Proactive personality、Personal initiative、Taking charge、Voice behavior 均可能屬於相關但不同的構念，不得互相替代。同樣地，Company identity、Corporate identity、Brand identity、Consumer–company identification、Consumer–brand identification、Brand identification、Brand image、Brand meaning、Identity attractiveness 不得自行視為同義詞。

5. 對 Proactive Postsales Service, PPS（主動售後服務）相關文獻，需保持 Proactive prevention（主動預防）、Proactive education（主動教育）、Proactive feedback seeking（主動尋求回饋）三類行動的原始概念差異，不得統稱為一般性的「主動服務」。若原文提出其他 proactive actions（主動行動），請依原文翻譯，不得自行歸入上述三類。

6. PPS 的三個面向目前僅作為本研究的 sensitizing concepts（敏感化概念／初始觀察鏡頭）。若原文出現新的主動行為類型，不得強行分類為上述三類，忠實保留作者原本的分類。

7. 「Proactive Brand-Building Behavior（主動品牌建構行為）」目前為研究中的暫定工作名稱，不應被翻譯成既有且已驗證的正式理論構念。若原始文獻使用 proactive branding、brand-building behavior、brand-oriented behavior、proactive customer orientation 等名稱，必須依照原文分別處理。

8. 在 C–C Identification（消費者—企業認同）相關文獻中，維持 Company identity（企業身分）、Identity similarity（身分相似性）、Identity distinctiveness（身分獨特性）、Identity prestige（身分聲望）、Identity attractiveness（身分吸引力）、Consumer–Company Identification（消費者—企業認同）的區別與關係；若原文有明確模型關係，不得重新排列或簡化。

9. 若原文討論 C–C Identification 的結果，例如 Loyalty（忠誠）、Company promotion（企業推廣）、Customer recruitment（顧客招募）、Resilience to negative information（抵抗負面資訊）、Stronger demands on the company（對企業提出更高要求），請依原文翻譯，不自行統稱為「品牌擁護」或其他上位概念。

10. 研究若涉及 founder、brand creator、brand manager、employee、service employee、management team 等不同 actor（行動者），必須維持角色差異，不得全部翻成「品牌創建者」。

11. exploratory research（探索性研究）、qualitative research（質性研究）、case study（個案研究）、process research（歷程研究）、coding（編碼）等研究方法用語，使用台灣管理學研究常用譯法；deductive coding（演繹編碼）與 inductive coding（歸納編碼）必須維持區別。

12. antecedent、mechanism、mediator、moderator、outcome、dimension（構面）、construct（構念）、concept、category（類別）、theme（主題）、behavior（行為）請依學術意義分別翻譯，不可全部籠統譯為「因素」或「變項」。

13. 保留所有作者、年份、文獻引用、頁碼、Figure、Table、Appendix、Hypothesis、Proposition、研究命題與編號，例如 (Bhattacharya & Sen, 2003)、H1、Proposition 2、Figure 1、Table 3，均不得刪除、改號或自行補充。

14. 對直接引述、訪談逐字稿、受訪者原話與案例描述，忠實保留語氣與說話者角色，不要改寫成研究者觀點。

15. 若某英文構念沒有明確一致的繁體中文標準譯法：保留英文原文，並在第一次出現時於括號提供最合理的繁體中文譯法。不要為了中文流暢而自行創造新的學術名詞。

16. 使用台灣繁體中文的管理學與社會科學書寫習慣，優先使用：資料、資訊、透過、品質、顧客、企業、構念、構面、變數、研究發現、研究結果。避免不必要的中國大陸用語。

17. 同一句之內可依繁體中文語序適度重組，讓譯文順暢，但不得改變主詞、作用方向、條件關係、否定語意、程度、因果關係。

18. 僅輸出翻譯結果，不額外撰寫摘要、研究建議、評論或延伸解釋。`;

export const DEFAULT_RESEARCH_CONTEXT = `我的碩士論文（企管所，MBA）：「服務型品牌建構歷程中品牌創建者主動行為（Proactive Behavior）之研究」，探索性單一個案研究（Starbucks 臺灣）。
前半段：品牌核心成員的主動品牌建構行為（暫定工作名稱 Proactive Brand-Building Behavior），以 Challagalla, Venkatesh & Kohli (2009) Proactive Postsales Service 的主動預防、主動教育、主動尋求回饋作為敏感化概念。
後半段：沿用 Bhattacharya & Sen (2003) Consumer–Company Identification 架構（企業身分的相似性、獨特性、聲望 → 身分吸引力 → 消費者—企業認同 → 忠誠、企業推廣、顧客招募、抵抗負面資訊、對企業提出更高要求）。
相關領域：行銷、品牌、服務行銷、消費者行為、組織行為（proactive behavior、personal initiative、taking charge）、創業與創辦人行為。`;

export interface Journal {
  name: string;
  issn: string[]; // any ISSN (print or online); matching also falls back to the name
  tier: 1 | 2 | 3; // 1 = 老師推薦, 2 = 頂尖, 3 = 其他收錄
  field: "marketing" | "management" | "ob" | "service" | "entrepreneurship";
}

export const DEFAULT_JOURNALS: Journal[] = [
  { name: "Journal of Marketing", issn: ["0022-2429", "1547-7185"], tier: 1, field: "marketing" },
  { name: "Journal of Marketing Research", issn: ["0022-2437", "1547-7193"], tier: 2, field: "marketing" },
  { name: "Journal of Consumer Research", issn: ["0093-5301", "1537-5277"], tier: 2, field: "marketing" },
  { name: "Marketing Science", issn: ["0732-2399", "1526-548X"], tier: 2, field: "marketing" },
  { name: "Journal of the Academy of Marketing Science", issn: ["0092-0703", "1552-7824"], tier: 2, field: "marketing" },
  { name: "Journal of Service Research", issn: ["1094-6705", "1552-7379"], tier: 2, field: "service" },
  { name: "Journal of Retailing", issn: ["0022-4359"], tier: 2, field: "marketing" },
  { name: "Journal of Consumer Psychology", issn: ["1057-7408"], tier: 2, field: "marketing" },
  { name: "International Journal of Research in Marketing", issn: ["0167-8116"], tier: 2, field: "marketing" },
  { name: "Academy of Management Journal", issn: ["0001-4273", "1948-0989"], tier: 2, field: "management" },
  { name: "Academy of Management Review", issn: ["0363-7425", "1930-3807"], tier: 2, field: "management" },
  { name: "Journal of Applied Psychology", issn: ["0021-9010", "1939-1854"], tier: 2, field: "ob" },
  { name: "Administrative Science Quarterly", issn: ["0001-8392", "1930-3815"], tier: 2, field: "management" },
  { name: "Organization Science", issn: ["1047-7039", "1526-5455"], tier: 2, field: "management" },
  { name: "Journal of Management", issn: ["0149-2063", "1557-1211"], tier: 2, field: "management" },
  { name: "Journal of Organizational Behavior", issn: ["0894-3796", "1099-1379"], tier: 2, field: "ob" },
  { name: "Strategic Management Journal", issn: ["0143-2095", "1097-0266"], tier: 2, field: "management" },
  { name: "Journal of Management Studies", issn: ["0022-2380", "1467-6486"], tier: 2, field: "management" },
  { name: "Journal of Business Venturing", issn: ["0883-9026"], tier: 2, field: "entrepreneurship" },
  { name: "Entrepreneurship Theory and Practice", issn: ["1042-2587", "1540-6520"], tier: 2, field: "entrepreneurship" },
  { name: "Journal of Business Research", issn: ["0148-2963"], tier: 3, field: "marketing" },
  { name: "Journal of Brand Management", issn: ["1350-231X"], tier: 3, field: "marketing" },
  { name: "Journal of Product & Brand Management", issn: ["1061-0421"], tier: 3, field: "marketing" },
  { name: "Journal of Service Management", issn: ["1757-5818"], tier: 3, field: "service" },
  { name: "Journal of Services Marketing", issn: ["0887-6045"], tier: 3, field: "service" },
  { name: "Journal of Vocational Behavior", issn: ["0001-8791"], tier: 3, field: "ob" },
];

export const TIER_LABEL: Record<number, string> = { 1: "老師推薦", 2: "頂尖期刊", 3: "白名單" };

export function normalizeJournalName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchJournal(journals: Journal[], name?: string | null, issns?: string[] | null): Journal | undefined {
  const set = new Set((issns ?? []).map((x) => x.toUpperCase()));
  for (const j of journals) if (j.issn.some((x) => set.has(x.toUpperCase()))) return j;
  if (name) {
    const n = normalizeJournalName(name);
    return journals.find((j) => normalizeJournalName(j.name) === n);
  }
  return undefined;
}
