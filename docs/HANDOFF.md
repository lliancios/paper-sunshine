# Handoff: continuing Paper Sunshine in Claude Code

Last updated 2026-09-29 (v0.6.3). Read `CLAUDE.md` first; it holds the invariants.

## Where things stand

Deployed on Vercel from `main` (every push deploys; bumping `package.json` version makes CI tag a release).

| Version | What shipped |
|---|---|
| v0.1.0 | Reader, layout engine, sentence-ID two-way highlights, layout translation, sidebar, related papers |
| v0.2.0 | Quota-proof pipeline (guide pass + streamed batch translation), multi-provider models, one-page summary, synced split view |
| v0.3.0 | PWA (offline shell, `/read?id=`), Apple Pencil ink, one-pager in sidebar, error boundaries, chat answers anything |
| v0.4.0 | Supabase cross-device sync, line-precise citation chips with focus outline, Install App button |
| v0.4.1 | Clean table of contents (right sidebar), sync diagnostics + repair buttons, library sign-in banner, e2e scripts in repo |
| v0.5.0 | Double-click quick highlight, unified highlights panel (auto + mine, zh/en/both, categories), lookup menu |
| v0.5.1 | Resume reading position across devices (`papers.readPage`), step through summary citations |
| v0.6.0 | Zotero: import collections via Web API (`/api/zotero` proxy, key in localStorage only), triage mode (summary first, translate on open), conclusions in library rows, save highlights + summary back as a child note |
| v0.6.1 | "New version" banner works without Vercel system env vars (build timestamp); production sync wired to Supabase |
| v0.6.2 | Scanned PDFs render (pdf.js wasm decoders), echoed English stripped from translations (and repaired in stored ones), table cells parsed as separate units (ENGINE_VERSION 3), translated layer covers the real ink on scans, 「補翻」 for missing sentences |
| v0.6.3 | Translated boxes never overlap (`src/engine/boxes.ts`), scanned pages re-fitted to their ink on first view (`src/lib/inkFit.ts`), drop caps and footnote markers split sentences correctly (ENGINE_VERSION 4), all-pages overlap check |

## Open items, in priority order

1. **Sync is configured in production** (Supabase project `paper-sunshine`, ref `sjrgmvccubhtcakgscbc`, region Asia-Pacific; schema verified; "Confirm email" off; `SUPABASE_URL` and `SUPABASE_ANON_KEY` set in Vercel for Production). Still confirm on the owner's devices: create the account on the computer (設定 → 跨裝置同步 → 建立帳號), then sign in with the same account on iPad and iPhone. If the owner reports an error, ask for the text from 設定 → 跨裝置同步 → 同步診斷. Likely suspects: env vars not redeployed, `schema.sql` not fully run, "Confirm email" still on, iPad running an old cached build (tap the "有新版本" banner or relaunch).
2. Translation quality (owner's main complaint on 2026-09-27): v0.6.2 fixed the mechanical causes (echoed English, merged table cells, blank scans). If they still see bad translations, get a screenshot plus the paper, and check which model runs translation (設定 → 模型與連線); cheaper models echo and skip more. Tables without a "Table n" caption above them, or set in the body font, still use the paragraph rules.
3. Ideas the owner was offered (not started): reverse links (click a sentence, light up the one-pager lines citing it), read-aloud of the translation.
4. Writing studio (v0.7.0): thesis project with chapters, insert citations from the library and highlights, APA bibliography, `.docx` export that keeps layout, AI assistant panel. Dexie tables `projects` and `docs` already exist and are in the sync `ROWS` list.
5. Zotero: only tested against `tests/e2e/fake-zotero.mjs` (api.zotero.org is not reachable from the dev sandbox); confirm with a real key. Then citation cards (click an in-text citation to see the reference); phrase-level cross-language alignment.

## How to work

```bash
npm install
npm test                       # engine tests (+ real-paper regressions if tests/fixtures/*.pdf exist locally)
npm run typecheck
npm run build && MOCK_STYLE=zh npx next start -p 3100    # demo mode without AI keys
```

Browser checks: see `tests/e2e/README.md` (reader, ink, one-pager focus, offline, sync between two browser profiles, diagnostics).

Before any release touching layout, parsing or the reader: `npm test` (checks translated boxes on every page of every fixture) and `tests/e2e/overlap-all-pages.mjs` on every local fixture PDF (`EXPECT_FIT=0` for born-digital, `EXPECT_FIT=1` for `cc.pdf`). The owner's complaint was that fixes held only for the page in the screenshot; never tune on one page.

Release checklist: bump `package.json` + `src/lib/version.ts`, add a `CHANGELOG.md` section (Traditional Chinese), update README if user-facing, commit, push `main`. The GitHub Action creates the tag and release.

## Style reminders

UI copy in Traditional Chinese (Taiwan): 訊息 not 信息, no 口徑, no em dashes. Keep changes small and verified; the owner reads results on iPad and Mac.
