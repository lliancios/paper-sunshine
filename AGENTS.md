# Paper Sunshine: notes for coding agents

Status and next steps: `docs/HANDOFF.md`. Browser checks: `tests/e2e/README.md`.

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
- Exception: handwriting (`ink` table, `InkLayer.tsx`) is stored in PDF page units at scale 1 (the same space as piece rects), never screen pixels. Drawn precisely on its `side`, mirrored faintly on the other.
- AI answers cite sentences as `[[sid]]` (one-pager, chat); `CitedMarkdown` in `OnePager.tsx` turns them into page chips that scroll to and flash the sentences.

## Layout
- `src/lib/pipeline.ts`: parse → OpenAlex metadata → overview/glossary → per-page translate (+auto-highlight categories in the same call) → related papers. Checkpointed in IndexedDB; `setFocus` prioritises the page being read.
- `src/lib/db.ts`: Dexie tables. User-authored rows have `updatedAt` and `deleted` tombstones. Use soft delete for highlights/explanations/chats; `deletePaper` keeps a tombstone paper row.
- Sync (`src/lib/sync.ts`, schema in `supabase/schema.sql`): Dexie hooks queue changes in `outbox`; push goes through the `ps_push` RPC (last writer wins on `updated_at`); pull reads `ps_records` by server `rev`. Rows in `ROWS` sync one by one; translations + auto highlights + page status travel as one `gen` bundle per paper (union merge; `resetTranslations` bumps an epoch to replace instead). PDFs and models live in the `ps-files` bucket and download on demand (`ensurePaperLocal`). Writes applied from the cloud run inside `applyRemote` so hooks don't echo them. A new synced table must be added to `ROWS` (and have a simple primary key plus an updated timestamp).
- `src/app/api/*`: server routes. Keys live only in env vars (`GEMINI_API_KEY`, `OPENALEX_API_KEY`); every route calls `requireAuth` (header `x-ps-pass` vs `APP_PASSCODE`). Without a Gemini key, routes return mock data (`src/lib/server/mock.ts`; `MOCK_STYLE=zh` gives Chinese-shaped filler for layout testing).
- Gemini: plain REST in `src/lib/server/gemini.ts`, Gemini 3.x rules (`thinkingLevel`, no temperature). Default model `gemini-3.8-flash`.
- Routes: library `/`, reader `/read?id=<paperId>` (one static page shell so the installed app opens any paper offline; `/read/[id]` only redirects). Link with `readHref()` from `src/lib/routes.ts`.
- PWA: `src/app/manifest.ts`, `public/sw.js` (caches the app shell and `/_next/static`; never `/api`). Cache names follow `APP_VERSION`, so bump the version to roll the cache.
- Errors: wrap new panels/popovers in `ErrorBoundary` (`src/components/ErrorBoundary.tsx`); `src/lib/recover.ts` reloads once on missing chunks after a deploy and `AppFrame` shows a "new version" banner when `/api/health` reports another build.
- Reader UI: `src/components/reader/` (`Pages.tsx` two synced scroll panes, `SourceLayer.tsx`, `TranslatedLayer.tsx`, `InkLayer.tsx` + `InkToolbar.tsx`, `Popovers.tsx`, `RightSidebar.tsx`, `OnePager.tsx`, `Toolbar.tsx`). State in `src/store/reader.ts` (zustand).

## Style
- UI copy is Traditional Chinese (Taiwan). Use 訊息 (never 信息), avoid 口徑, and never use em dashes in UI text or prompts.
- Versioning: minor bump per iteration round (v0.2.0), patch for fixes within a round; tag each release and update CHANGELOG.md and `src/lib/version.ts` + `package.json`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
