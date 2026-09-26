# Paper Sunshine ☀️

AI 論文閱讀器。以 Moonlight 的功能為基底，補上它做不到的一件事：**原文與版面翻譯兩側都能劃線、懸浮對照、解釋，而且即時同步。**

> 目前版本：**v0.1.0**（MVP）。版本規則見文末。

## 核心差異：句子身分證

Moonlight 的版面翻譯是另外產生一份 PDF，中文側只是一張圖，無法劃線。Paper Sunshine 解析 PDF 時會給每一句英文一個固定 ID（例如 `3.12`，第 3 頁第 12 句），翻譯時 Gemini 必須原樣帶回 ID。所有功能都作用在 ID 上，而不是螢幕座標：

- 在中文劃線，英文側同一句自動出現（虛線底）；在英文劃線，中文側同一句也會出現。
- 滑鼠停在任一側的句子上，另一側同一句會亮起（iPad 用點一下）。
- 自動高亮（創新性、方法、結果、研究缺口、限制）兩側同時顯示。
- 中文側不是圖片，而是蓋在原頁面上的活文字：圖、表、公式保持原樣，文字可選取、解釋、複製引用。

## v0.1.0 功能

| 區塊 | 功能 |
|---|---|
| 文獻庫 | 清單／卡片檢視、評分、註釋、標籤、資料夾、搜尋、篩選、拖放上傳、以 DOI 加入（沒全文先建書目，之後拖入 PDF 依 DOI 自動配對） |
| 閱讀器 | 並排檢視／僅看譯文／僅看原文、縮放（含 Ctrl/⌘ 滾輪）、頁碼跳轉、目錄、原文與譯文全文搜尋 |
| 翻譯 | 上傳後背景整篇翻譯，逐頁存檔，關掉網頁下次從斷點續跑；正在讀的頁面優先翻 |
| 術語 | 先建全文術語表，只在全文第一次出現時用「English（中文）」格式，平行翻譯也不會每頁重複 |
| 自動高亮 | 與翻譯同一次呼叫產生，不額外花費；三種配色（Sunshine Basic、Deep Spread、Point Stroke）；分類可自訂 |
| 劃線 | 5 色劃線、評論，兩側同步；鍵盤 1 到 5 快速劃線 |
| 解釋 | 選取文字按「解釋」（或按 E）；原文選取可按「翻譯」（或按 T）看對照 |
| 圖片說明 | 框選任意區域，或按圖表標題旁的「解讀這張圖」；提供「解讀這張圖」與「研究概念模型分析」 |
| 側邊欄 | 與 AI 一起（三句摘要、詳細摘要、關鍵詞詞典、討論）、測驗（中英雙語）、高亮、解釋、評論、筆記、引用卡片（參考文獻與被引用），可移到底部 |
| 相關論文 | OpenAlex 引用網路加關鍵詞搜尋，期刊白名單（以 ISSN 比對，名稱備援），Gemini 依你的研究脈絡重新排序並寫出推薦理由；有免費全文的一鍵下載開啟 |
| 引用 | 劃線自動帶印刷頁碼，一鍵複製 APA 文中引用，例如 “…” (Sonnentag, 2003, p. 519)；匯出 RIS（含劃線筆記）給 Zotero，再從 Zotero 插入 Word |
| 裝置 | 電腦、iPad、手機瀏覽器皆可用，可「加入主畫面」當 App；深色模式 |

## 部署到 Vercel（第一次約 10 分鐘）

1. 登入 [vercel.com](https://vercel.com)，按 **Add New → Project**，選擇 GitHub 的 `lliancios/paper-sunshine`，按 **Import**。
2. 在 **Environment Variables** 加入：

   | 名稱 | 值 |
   |---|---|
   | `GEMINI_API_KEY` | Google AI Studio 的金鑰 |
   | `OPENALEX_API_KEY` | [openalex.org/settings/api](https://openalex.org/settings/api) 的免費金鑰 |
   | `APP_PASSCODE` | 自己設一組密碼，保護你的 API 額度 |
   | `GEMINI_MODEL_TRANSLATE`（選填） | 預設 `gemini-3.8-flash` |
   | `GEMINI_MODEL_CHAT`（選填） | 預設 `gemini-3.8-flash` |

3. 按 **Deploy**。完成後打開網址，輸入 `APP_PASSCODE`。
4. iPad／手機：用 Safari 打開網址 → 分享 → **加入主畫面**。

之後每次 push 到 `main`，Vercel 會自動重新部署。沒有設定 `GEMINI_API_KEY` 時會進入示範模式（假譯文），方便先看介面。

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
src/lib/pipeline   背景流程：解析 → 書目 → 術語表 → 逐頁翻譯與自動高亮 → 相關論文
src/lib/db         IndexedDB（Dexie）；使用者資料都有 updatedAt 與刪除標記，v0.2.0 可直接同步
src/app/api/       伺服器端：Gemini（翻譯、解釋、討論、圖片）、OpenAlex（書目、引用、推薦）
src/components/reader/  閱讀器：SourceLayer（原文）、TranslatedLayer（版面翻譯）、Popovers、側邊欄
```

API 金鑰只存在伺服器端，瀏覽器只保存 `APP_PASSCODE`。

## 路線圖

- **v0.2.0**：Supabase 雲端同步（電腦、iPad、手機即時看到同一份劃線，只同步變動的那一筆）、Zotero API 一鍵同步
- **v0.3.0**：Apple Pencil 手寫劃記、片語級跨語對齊（選配）
- 之後：引用卡片（點文中引用直接看摘要）、Scholar Deep Search、Chrome 擴充

## 版本規則

`主版號.次版號.修訂號`。每一輪功能迭代升次版號（v0.1.0 → v0.2.0），同一輪內的修正升修訂號（v0.1.1）。每一版都有 git tag，變更記錄在 [CHANGELOG.md](CHANGELOG.md)。

## 授權與致謝

- PDF 渲染：[PDF.js](https://github.com/mozilla/pdf.js)（Apache-2.0）
- 書目資料：[OpenAlex](https://openalex.org)（CC0）
- 本專案與 Moonlight（Corca, Inc.）無任何關係，只參考其公開的功能設計。
