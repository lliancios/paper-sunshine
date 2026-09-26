# Paper Sunshine ☀️

AI 論文閱讀器。以 Moonlight 的功能為基底，補上它做不到的一件事：**原文與版面翻譯兩側都能劃線、懸浮對照、解釋，而且即時同步。**

> 目前版本：**v0.4.0**。版本規則見文末，變更見 [CHANGELOG.md](CHANGELOG.md)。

## 核心差異：句子身分證

Moonlight 的版面翻譯是另外產生一份 PDF，中文側只是一張圖，無法劃線。Paper Sunshine 解析 PDF 時會給每一句英文一個固定 ID（例如 `3.12`，第 3 頁第 12 句），翻譯時 Gemini 必須原樣帶回 ID。所有功能都作用在 ID 上，而不是螢幕座標：

- 在中文劃線，英文側同一句自動出現（虛線底）；在英文劃線，中文側同一句也會出現。
- 滑鼠停在任一側的句子上，另一側同一句會亮起（iPad 用點一下）。
- 自動高亮（創新性、方法、結果、研究缺口、限制）兩側同時顯示。
- 中文側不是圖片，而是蓋在原頁面上的活文字：圖、表、公式保持原樣，文字可選取、解釋、複製引用。

## 功能

| 區塊 | 功能 |
|---|---|
| 文獻庫 | 清單／卡片檢視、評分、註釋、標籤、資料夾、搜尋、篩選、拖放上傳、以 DOI 加入（沒全文先建書目，之後拖入 PDF 依 DOI 自動配對） |
| 閱讀器 | 並排檢視（左右兩個同步捲動區，放大後仍對齊）／僅看譯文／僅看原文、縮放（含 Ctrl/⌘ 滾輪）、頁碼跳轉、目錄、原文與譯文全文搜尋 |
| 翻譯 | 上傳後背景整篇翻譯（串流批次，一篇約 6 到 8 次呼叫），邊翻邊顯示，關掉網頁下次從斷點續跑；正在讀的頁面優先翻；額度用完自動暫停、隔天續跑 |
| 一頁速覽 | 依 Keshav 三遍讀法與五個 C 整理研究問題、理論、方法、發現、貢獻、限制與可引用句，每個論點附頁碼，點了跳回原句 |
| 術語 | 先建全文術語表，只在全文第一次出現時用「English（中文）」格式，平行翻譯也不會每頁重複 |
| 自動高亮 | 上傳後一次產生全文高亮（與導讀同一次呼叫），還沒翻譯的頁面也有；三種配色（Sunshine Basic、Deep Spread、Point Stroke）；分類可自訂 |
| 劃線 | 5 色劃線、評論，兩側同步；鍵盤 1 到 5 快速劃線 |
| 解釋 | 選取文字按「解釋」（或按 E）；原文選取可按「翻譯」（或按 T）看對照 |
| 圖片說明 | 框選任意區域，或按圖表標題旁的「解讀這張圖」；提供「解讀這張圖」與「研究概念模型分析」 |
| 側邊欄 | 與 AI 一起（三句摘要、詳細摘要、關鍵詞詞典、討論）、測驗（中英雙語）、高亮、解釋、評論、筆記、引用卡片（參考文獻與被引用），可移到底部 |
| 相關論文 | OpenAlex 引用網路加關鍵詞搜尋，期刊白名單（以 ISSN 比對，名稱備援），Gemini 依你的研究脈絡重新排序並寫出推薦理由；有免費全文的一鍵下載開啟 |
| 引用 | 劃線自動帶印刷頁碼，一鍵複製 APA 文中引用，例如 “…” (Sonnentag, 2003, p. 519)；匯出 RIS（含劃線筆記）給 Zotero，再從 Zotero 插入 Word |
| 手寫 | Apple Pencil、手指或滑鼠直接在頁面上寫字、畫線；筆、螢光筆、橡皮擦，壓力感應；筆跡跟著頁面縮放，兩側對照顯示 |
| 裝置 | 電腦、iPad、手機皆可用；「加入主畫面」或「安裝 App」後就是全螢幕 App，已匯入的論文離線可讀；深色模式 |
| 跨裝置同步 | 用你自己的免費 Supabase：文獻庫、PDF、譯文、高亮、劃線、筆記、討論、手寫、速覽、設定在電腦、iPad、手機之間同步；離線照常使用，連線後自動補上 |

## 部署到 Vercel（第一次約 10 分鐘）

1. 登入 [vercel.com](https://vercel.com)，按 **Add New → Project**，選擇 GitHub 的 `lliancios/paper-sunshine`，按 **Import**。
2. 在 **Environment Variables** 加入：

   | 名稱 | 值 |
   |---|---|
   | `APP_PASSCODE` | 自己設一組密碼，保護你的 API 額度 |
   | `GEMINI_API_KEY` | Google AI Studio 的金鑰（免費） |
   | `OPENALEX_API_KEY` | [openalex.org/settings/api](https://openalex.org/settings/api) 的免費金鑰，相關論文需要 |
   | `DEEPSEEK_API_KEY`（選填） | 最省的付費選項，一篇論文約 0.01 到 0.05 美元 |
   | `OPENROUTER_API_KEY`、`SILICONFLOW_API_KEY`、`GROQ_API_KEY`（選填） | 其他備援 |
   | `CUSTOM_LLM_BASE_URL`、`CUSTOM_LLM_API_KEY`（選填） | 任何 OpenAI 相容服務 |

   AI 金鑰至少設一個；哪個模型負責翻譯、哪個負責解釋，在 App 的「設定 → 模型」選擇。

3. 按 **Deploy**。完成後打開網址，輸入 `APP_PASSCODE`。
4. iPad／手機：用 Safari 打開網址 → 分享 → **加入主畫面**。之後從主畫面開啟就是全螢幕 App，沒網路時也能讀已匯入的論文。

之後每次 push 到 `main`，Vercel 會自動重新部署。沒有設定 `GEMINI_API_KEY` 時會進入示範模式（假譯文），方便先看介面。

## 跨裝置同步

同步用你自己的 Supabase 免費專案（500 MB 資料庫、1 GB 檔案空間，約可放數百篇論文），資料只在你的帳號裡。設定一次約 5 分鐘：

1. **建立專案**：到 [supabase.com](https://supabase.com) 用 GitHub 登入 → New project。名稱 `paper-sunshine`，資料庫密碼隨意，Region 選 **Northeast Asia (Tokyo)**。
2. **建資料表**：左側 **SQL Editor** → New query → 貼上 [`supabase/schema.sql`](supabase/schema.sql) 全部內容 → **Run**（可以重複執行）。
3. **關掉確認信**：**Authentication** → Sign In / Providers → **Email** → 關掉 **Confirm email** → Save。（之後想更安全，可以在建立好自己的帳號後，把 **Allow new users to sign up** 也關掉。）
4. **加到 Vercel**：Supabase 上方 **Connect**（或 Project Settings → API）複製 **Project URL** 與 **anon public／Publishable key**，在 Vercel → Settings → Environment Variables 新增 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY`，然後重新部署一次（Deployments → 最新一筆 → Redeploy）。
5. **登入**：電腦上打開 Paper Sunshine → 設定 → **跨裝置同步** → **建立帳號**，現有的論文與 PDF 會自動上傳。iPad、iPhone 在主畫面的 App 裡用同一組帳號**登入**即可。

同步的方式：每次修改會記在本機，連線時上傳；其他裝置開啟、切回前景、或每 90 秒會下載新變更（有開著的話幾乎即時）。同一筆資料兩邊都改時，以最後修改的為準；AI 產生的譯文與高亮會合併，不會重複花額度。PDF 在第一次打開時才下載，設定裡也有「下載全部 PDF 供離線閱讀」。

## 模型與額度

| 方案 | 翻譯 | 解釋與討論 | 適合 |
|---|---|---|---|
| Gemini 免費 | `gemini:gemini-3.5-flash-lite`（每日約 500 次） | `gemini:gemini-3.8-flash`（每日約 20 次） | 先試用 |
| DeepSeek 最省 | `deepseek:deepseek-flash` | 同左 | 大量閱讀，一篇約 0.01 到 0.05 美元 |
| 混搭 | DeepSeek | Gemini Flash | 翻譯便宜、解釋品質高 |

額度用完時：每分鐘上限會自動等；每日上限會先改用 Flash-Lite，仍不行就暫停，等太平洋時間午夜（台灣下午 3 點或 4 點）自動續跑。設定 → 模型 → **執行診斷** 可一次檢查所有服務。

## 本機開發

```bash
npm install          # 會把 pdf.js worker 與字型複製到 public/pdfjs
cp .env.example .env.local   # 填入金鑰
npm run dev          # http://localhost:3000
npm test             # 版面解析引擎測試（產生雙欄測試論文並驗證句子切分）
npm run typecheck
```

## 架構

```
src/engine/        PDF 版面解析：行 → 段落區塊 → 閱讀順序 → 句子（ID、字元幾何）
src/lib/pipeline   背景流程：解析 → 書目 → 導讀（術語表、全文高亮）→ 批次翻譯 → 相關論文 → 一頁速覽
src/lib/db         IndexedDB（Dexie）；使用者資料都有 updatedAt 與刪除標記
src/lib/sync       跨裝置同步（Supabase）：變更佇列、推送、拉取、PDF 按需下載
src/lib/server/llm 模型層：Gemini 與 OpenAI 相容服務，額度用完自動改用備援模型
src/app/api/       伺服器端：AI（翻譯、導讀、解釋、討論、圖片、一頁速覽）、OpenAlex 與 Crossref（書目、引用、推薦）、診斷
src/components/reader/  閱讀器：SourceLayer（原文）、TranslatedLayer（版面翻譯）、Popovers、側邊欄
```

API 金鑰只存在伺服器端，瀏覽器只保存 `APP_PASSCODE`。

## 路線圖

- **v0.5.0**：論文寫作區（章節、從文獻庫插入引用、APA 參考文獻、匯出 Word 不跑版、AI 助手）
- 之後：Zotero API 一鍵同步、引用卡片（點文中引用直接看摘要）、片語級跨語對齊

## 版本規則

`主版號.次版號.修訂號`。每一輪功能迭代升次版號（v0.1.0 → v0.2.0），同一輪內的修正升修訂號（v0.1.1）。每一版都有 git tag，變更記錄在 [CHANGELOG.md](CHANGELOG.md)。

## 授權與致謝

- PDF 渲染：[PDF.js](https://github.com/mozilla/pdf.js)（Apache-2.0）
- 書目資料：[OpenAlex](https://openalex.org)（CC0）
- 本專案與 Moonlight（Corca, Inc.）無任何關係，只參考其公開的功能設計。
