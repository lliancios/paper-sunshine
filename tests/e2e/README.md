# Browser tests (Playwright scripts)

Plain Node scripts, not a test runner. They print what they measured; read the output.

```bash
npm i --no-save playwright && npx playwright install chromium   # once
npm test                       # also writes tests/fixtures/two-column.pdf
npm run build
MOCK_STYLE=zh npx next start -p 3100 &                     # demo mode, no AI keys needed
PDF=tests/fixtures/two-column.pdf SHOTS=/tmp node tests/e2e/reader.mjs
```

| Script | Checks |
|---|---|
| `reader.mjs` | highlight on the translated side mirrors to the source (and back), hover sync, popover, panels |
| `figure-explain-ipad.mjs` | figure explanation, explain via keyboard, iPad tap pins a sentence on both sides |
| `ink.mjs` | Pencil/mouse strokes stored in page units, mirrored side, eraser, undo |
| `onepager-focus.mjs` | one-page summary in the sidebar, `[[a, b]]` citations become "p.X 左欄 N 行" chips, focus outline, 回原處, highlight regeneration |
| `quick-highlight.mjs` | double-click whole-sentence highlight on both sides, unified highlights panel (filters, zh/en/both, categories), lookup menu |
| `sync-diagnose.mjs` | sync diagnostics and the re-download button against the fake backend |
| `panels.mjs` | every sidebar tab and the chat open without crashing |
| `offline.mjs` | service worker: reader opens offline (never visited), library offline, legacy `/read/<id>` |
| `error-boundary.mjs` | a corrupt record shows an in-panel error card instead of a blank page |
| `sync-two-devices.mjs` | two browser profiles against `fake-supabase.mjs`: first sign-in uploads the library, second device downloads PDF/model/annotations/ink, deletes propagate both ways |

For the sync test, start the fake backend and point the app at it:

```bash
node tests/e2e/fake-supabase.mjs &            # http://localhost:54321, in-memory, restart to reset
MOCK_STYLE=zh SUPABASE_URL=http://localhost:54321 SUPABASE_ANON_KEY=fake npx next start -p 3100 &
PDF=tests/fixtures/two-column.pdf node tests/e2e/sync-two-devices.mjs
```

Set `CHROMIUM=/path/to/chrome` if Playwright's own browser is not installed.
