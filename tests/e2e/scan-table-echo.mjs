// Scanned pages render, table cells are separate units, echoed English is stripped
// (new and stored translations), and "補翻" fills sentences a page is missing.
// Server: MOCK_STYLE=echo npx next start -p 3100 (the mock repeats the English before its "translation").
// Run: SCAN=tests/fixtures/cc.pdf TABLE=tests/fixtures/pps.pdf SHOTS=/tmp node tests/e2e/scan-table-echo.mjs
import { chromium } from "playwright";
const SHOTS = process.env.SHOTS ?? "/tmp";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "✓" : "✗"} ${name}`, ok ? "" : JSON.stringify(detail ?? ""));
};

await page.goto("http://localhost:3100/");
await page.waitForSelector("text=文獻庫");
await page.setInputFiles("input[type=file][multiple]", [process.env.SCAN, process.env.TABLE]);
await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 2, null, { timeout: 60000 });

async function openRow(re) {
  await page.goto("http://localhost:3100/");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 2);
  const rows = page.locator("tbody tr");
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    if (re.test(await rows.nth(i).innerText())) {
      await rows.nth(i).locator("td").first().click();
      await page.waitForURL(/\/read/);
      return;
    }
  }
  throw new Error(`no row matches ${re}`);
}

async function scrollToPage(i) {
  await page.evaluate((i) => document.querySelector(`[data-row="${i}"]`)?.scrollIntoView({ block: "start" }), i);
  await page.waitForTimeout(2500);
}

// 1) scanned JSTOR page (CCITT image) is drawn, not blank
await openRow(/identification|consumer|cc\.pdf/i);
await page.waitForSelector('[data-row="1"] canvas', { timeout: 60000 });
await scrollToPage(1);
// Decoding a 600 dpi scan takes a few seconds; poll.
let ink = -1;
for (let i = 0; i < 20 && ink <= 3; i++) {
  await page.waitForTimeout(1000);
  ink = await page.evaluate(() => {
    const c = document.querySelector('[data-row="1"] canvas');
    if (!c || !c.width) return -1;
    const d = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 128) dark++;
    return (100 * dark) / (c.width * c.height);
  });
}
await page.screenshot({ path: `${SHOTS}/scan-page.png` });
check("scanned page is drawn (dark pixels > 3%)", ink > 3, ink.toFixed?.(2) ?? ink);

// 2) table page of the PPS paper
await openRow(/postsales|proactive|pps\.pdf/i);
await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 60000 });
await page.waitForFunction(() => !document.body.innerText.includes("翻譯中…"), null, { timeout: 120000 }).catch(() => {});
await scrollToPage(11);
await page.waitForSelector('[data-side="tgt"][data-page="11"] .ps-tblock', { timeout: 60000 });
await page.waitForTimeout(1500);
const table = await page.evaluate(() => {
  const src = [...document.querySelectorAll('[data-side="src"][data-page="11"] span[data-sid]')];
  const sidOf = (pre) => src.find((s) => (s.textContent ?? "").startsWith(pre))?.dataset.sid;
  const cell = sidOf("Customers may attribute");
  const header = sidOf("Insights from the");
  const tgt = (sid) => document.querySelector(`[data-side="tgt"] [data-sent="${sid}"]`)?.textContent ?? null;
  const all = [...document.querySelectorAll('[data-side="tgt"][data-page="11"] [data-sent]')].map((s) => s.textContent ?? "");
  return {
    blocks: document.querySelectorAll('[data-side="tgt"][data-page="11"] .ps-tblock').length,
    cellSid: cell,
    headerSid: header,
    cellText: cell ? tgt(cell) : null,
    echoed: all.filter((t) => /[A-Za-z]{4,}\s+[A-Za-z]{4,}\s+[A-Za-z]{4,}/.test(t)).slice(0, 3),
  };
});
await page.screenshot({ path: `${SHOTS}/table-page.png` });
check("Table 4 cells are separate blocks (>= 20)", table.blocks >= 20, table.blocks);
check("cell and header are different sentences", !!table.cellSid && !!table.headerSid && table.cellSid !== table.headerSid, table);
check("translated cell has no echoed English", !!table.cellText && !/Customers may attribute/.test(table.cellText), table.cellText);
check("no echoed English sentences on the page", table.echoed.length === 0, table.echoed);

// 3) a stored echo from an older run is repaired on open, and a highlight on it keeps its words
const paperId = new URL(page.url()).searchParams.get("id");
const seeded = await page.evaluate(
  async ({ paperId, sid }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("paper-sunshine");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const get = (store, key) => new Promise((res) => (db.transaction(store).objectStore(store).get(key).onsuccess = (e) => res(e.target.result)));
    const put = (store, v) => new Promise((res) => (db.transaction(store, "readwrite").objectStore(store).put(v).onsuccess = res));
    const del = (store, key) => new Promise((res) => (db.transaction(store, "readwrite").objectStore(store).delete(key).onsuccess = res));
    const model = (await get("models", paperId)).model;
    const src = model.sentences[sid].text;
    const zh = "顧客可能將供應商的主動聯繫歸因於短視的自利或利他。";
    await put("translations", { paperId, sid, page: model.sentences[sid].p, t: `${src} ${zh}`, c: null });
    const start = src.length + 1 + 2;
    await put("highlights", { id: "e2e-echo", paperId, side: "tgt", ranges: [{ sid, start, end: start + 4 }], color: "yellow", style: "highlight", note: "", text: zh.slice(2, 6), page: 11, createdAt: Date.now(), updatedAt: Date.now() });
    // and drop another sentence's translation so the page has a hole to fill
    const holeSid = model.pages[11].blocks.filter((b) => b.kind !== "skip").flatMap((b) => b.sids).find((s) => s !== sid);
    await del("translations", [paperId, holeSid]);
    return { src, zh, holeSid, start };
  },
  { paperId, sid: table.cellSid },
);
await page.reload();
await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 60000 });
await scrollToPage(11);
const repaired = await page.evaluate(
  ({ sid }) => {
    const sent = document.querySelector(`[data-side="tgt"] [data-sent="${sid}"]`);
    const segs = [...(sent?.querySelectorAll("[data-start]") ?? [])].map((s) => ({ start: Number(s.dataset.start), text: s.textContent, bg: !!s.style.backgroundColor }));
    return { text: sent?.textContent ?? null, marked: segs.filter((s) => s.bg) };
  },
  { sid: table.cellSid },
);
check("stored echo is stripped on open", repaired.text === seeded.zh, repaired.text);
check("highlight on the translation keeps its words", repaired.marked.length === 1 && repaired.marked[0].text === seeded.zh.slice(2, 6), repaired.marked);

// 4) the page offers to translate the missing sentence, and does
const pill = page.locator('[data-side="tgt"][data-page="11"] button', { hasText: "補翻" });
check("missing-sentence pill appears", (await pill.count()) === 1 && /1 句沒翻到/.test(await pill.innerText()), await pill.count());
await page.screenshot({ path: `${SHOTS}/missing-pill.png` });
await pill.click();
await page.waitForTimeout(2500);
const filled = await page.evaluate((sid) => document.querySelector(`[data-side="tgt"] [data-sent="${sid}"]`)?.getAttribute("style") ?? "", seeded.holeSid);
check("補翻 fills the sentence and the pill goes away", !filled.includes("italic") && (await pill.count()) === 0, filled);

check("no page errors", errors.length === 0, errors.slice(0, 3));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
