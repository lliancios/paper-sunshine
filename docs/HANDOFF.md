# Handoff: continuing Paper Sunshine in Claude Code

Last updated 2026-09-27 (v0.4.1). Read `CLAUDE.md` first; it holds the invariants.

## Where things stand

Deployed on Vercel from `main` (every push deploys; bumping `package.json` version makes CI tag a release).

| Version | What shipped |
|---|---|
| v0.1.0 | Reader, layout engine, sentence-ID two-way highlights, layout translation, sidebar, related papers |
| v0.2.0 | Quota-proof pipeline (guide pass + streamed batch translation), multi-provider models, one-page summary, synced split view |
| v0.3.0 | PWA (offline shell, `/read?id=`), Apple Pencil ink, one-pager in sidebar, error boundaries, chat answers anything |
| v0.4.0 | Supabase cross-device sync, line-precise citation chips with focus outline, Install App button |
| v0.4.1 | Clean table of contents (right sidebar), sync diagnostics + repair buttons, library sign-in banner, e2e scripts in repo |

## Open items, in priority order

1. **Confirm sync works on the owner's real Supabase project.** Only tested against `tests/e2e/fake-supabase.mjs`. If the owner reports an error, ask for the text from 設定 → 跨裝置同步 → 同步診斷. Likely suspects: env vars not redeployed, `schema.sql` not fully run, "Confirm email" still on, iPad running an old cached build (tap the "有新版本" banner or relaunch).
2. Ideas the owner was offered (not started): reverse links (click a sentence, light up the one-pager lines citing it), remember reading position per paper across devices (store `lastPage` on `papers`), "previous / next citation" stepping, read-aloud of the translation.
3. Writing studio (v0.5.0): thesis project with chapters, insert citations from the library and highlights, APA bibliography, `.docx` export that keeps layout, AI assistant panel. Dexie tables `projects` and `docs` already exist and are in the sync `ROWS` list.
4. Zotero API sync; citation cards (click an in-text citation to see the reference); phrase-level cross-language alignment.

## How to work

```bash
npm install
npm test                       # engine tests (+ real-paper regressions if tests/fixtures/*.pdf exist locally)
npm run typecheck
npm run build && MOCK_STYLE=zh npx next start -p 3100    # demo mode without AI keys
```

Browser checks: see `tests/e2e/README.md` (reader, ink, one-pager focus, offline, sync between two browser profiles, diagnostics).

Release checklist: bump `package.json` + `src/lib/version.ts`, add a `CHANGELOG.md` section (Traditional Chinese), update README if user-facing, commit, push `main`. The GitHub Action creates the tag and release.

## Style reminders

UI copy in Traditional Chinese (Taiwan): 訊息 not 信息, no 口徑, no em dashes. Keep changes small and verified; the owner reads results on iPad and Mac.
