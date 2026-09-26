# Paper Sunshine: notes for coding agents

AI paper reader (Next.js 16 App Router, React 19, TypeScript, Tailwind 4, pdf.js 6, Dexie). The owner iterates with Claude Code and Codex; keep changes small and verified.

## Commands
- `npm run dev`, `npm run build`, `npm run typecheck`
- `npm test`: engine tests (generates a two-column fixture PDF with pdf-lib, runs pdf.js in Node). Run after any change in `src/engine/`.
- Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before using unfamiliar APIs. `middleware` is `proxy`; request APIs are async.
- pdf.js 6: close documents with `doc.loadingTask.destroy()` (no `doc.destroy()`); legacy build is used for Safari/iPadOS.

## The one invariant: everything is keyed by sentence ID
- `src/engine/layout.ts` builds `DocModel`: sentences with IDs `"<page>.<n>"`, each with `pieces` (runs inside pdf.js text items) where `sentence.text.slice(piece.s, piece.e)` is exactly the text rendered in the source text layer.
- Translations are stored per sentence ID. Highlights/explanations store `ranges: {sid, start, end}[]` plus `side` ("src" | "tgt"). Offsets on "tgt" index into the translation string; on "src" into the sentence text.
- Rendering: the side a highlight was drawn on shows the precise range; the other side shows the whole sentence (dashed). Never store screen coordinates for text annotations.
- Every selectable text node sits in an element with `data-sid` and `data-start`, inside a container with `data-side` and `data-page` (`src/lib/selection.ts` relies on this).
- The translate prompt's output format (one item per sentence id, no merging/splitting) is locked in `src/lib/server/prompts.ts`; the user's role prompt only controls style. Do not let user settings change the format.
- Changing sentence segmentation changes IDs for newly parsed papers only; existing papers keep their stored model. Bump `DocModel.v` if the shape changes.

## Layout
- `src/lib/pipeline.ts`: parse → OpenAlex metadata → overview/glossary → per-page translate (+auto-highlight categories in the same call) → related papers. Checkpointed in IndexedDB; `setFocus` prioritises the page being read.
- `src/lib/db.ts`: Dexie tables. User-authored rows have `updatedAt` and `deleted` tombstones for the planned Supabase sync (v0.2.0). Use soft delete for highlights/explanations/chats.
- `src/app/api/*`: server routes. Keys live only in env vars (`GEMINI_API_KEY`, `OPENALEX_API_KEY`); every route calls `requireAuth` (header `x-ps-pass` vs `APP_PASSCODE`). Without a Gemini key, routes return mock data (`src/lib/server/mock.ts`; `MOCK_STYLE=zh` gives Chinese-shaped filler for layout testing).
- Gemini: plain REST in `src/lib/server/gemini.ts`, Gemini 3.x rules (`thinkingLevel`, no temperature). Default model `gemini-3.8-flash`.
- Reader UI: `src/components/reader/` (`Pages.tsx` virtualised rows, `SourceLayer.tsx`, `TranslatedLayer.tsx`, `Popovers.tsx`, `RightSidebar.tsx`, `Toolbar.tsx`). State in `src/store/reader.ts` (zustand).

## Style
- UI copy is Traditional Chinese (Taiwan). Use 訊息 (never 信息), avoid 口徑, and never use em dashes in UI text or prompts.
- Versioning: minor bump per iteration round (v0.2.0), patch for fixes within a round; tag each release and update CHANGELOG.md and `src/lib/version.ts` + `package.json`.
