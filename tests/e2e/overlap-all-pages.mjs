// Every page of every paper: translated boxes must not cover each other, text
// the page keeps (running headers, page numbers), or run off the page.
// Server: MOCK_STYLE=zh npx next start -p 3100
// Run: PDFS=tests/fixtures/cc.pdf,tests/fixtures/pps.pdf SHOTS=/tmp node tests/e2e/overlap-all-pages.mjs
import { chromium } from "playwright";
const SHOTS = process.env.SHOTS ?? "/tmp";
const pdfs = (process.env.PDFS ?? "tests/fixtures/two-column.pdf").split(",").filter(Boolean);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
let problems = 0;

for (const pdf of pdfs) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:3100/");
  await page.waitForSelector("text=文獻庫");
  await page.setInputFiles("input[type=file][multiple]", pdf);
  await page.waitForSelector("tbody tr", { timeout: 60000 });
  await page.locator("tbody tr td").first().click();
  await page.waitForURL(/\/read/);
  await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 90000 });
  await page.waitForFunction(() => !document.body.innerText.includes("翻譯中…"), null, { timeout: 180000 }).catch(() => {});
  const paperId = new URL(page.url()).searchParams.get("id");
  const pageCount = await page.evaluate(() => new Set([...document.querySelectorAll("[data-row]")].map((e) => e.dataset.row)).size);
  const name = pdf.split("/").pop();
  let bad = 0;
  for (let i = 0; i < pageCount; i++) {
    await page.evaluate((i) => document.querySelectorAll(`[data-row="${i}"]`).forEach((e) => e.scrollIntoView({ block: "start" })), i);
    // wait for the bitmap (scans take a few seconds) and for boxes to settle
    for (let t = 0; t < 30; t++) {
      await page.waitForTimeout(400);
      const ready = await page.evaluate((i) => {
        const c = document.querySelectorAll(`[data-row="${i}"] canvas`)[1] ?? document.querySelector(`[data-row="${i}"] canvas`);
        return !!c && c.width > 0;
      }, i);
      if (ready) break;
    }
    await page.waitForTimeout(1200);
    const res = await page.evaluate(
      async ({ i, paperId }) => {
        const db = await new Promise((r) => (indexedDB.open("paper-sunshine").onsuccess = (e) => r(e.target.result)));
        const rec = await new Promise((r) => (db.transaction("models").objectStore("models").get(paperId).onsuccess = (e) => r(e.target.result)));
        const pg = rec.model.pages[i];
        const layer = document.querySelector(`[data-side="tgt"][data-page="${i}"]`);
        if (!layer) return { missing: true };
        const box = layer.getBoundingClientRect();
        const k = box.width / pg.w;
        const boxes = [...layer.querySelectorAll(".ps-tblock")].map((el) => {
          const r = el.getBoundingClientRect();
          return { text: (el.textContent ?? "").slice(0, 24), r: [(r.left - box.left) / k, (r.top - box.top) / k, (r.right - box.left) / k, (r.bottom - box.top) / k], over: el.scrollHeight > el.clientHeight + 2 };
        });
        const keep = pg.blocks.filter((b) => b.kind === "skip" && b.r[2] - b.r[0] > 4).map((b) => ({ text: `(skip) ${b.text ?? ""}`.slice(0, 24), r: b.r }));
        const area = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
        const inter = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
        const out = [];
        for (let a = 0; a < boxes.length; a++) {
          for (let b = a + 1; b < boxes.length; b++) {
            const x = inter(boxes[a].r, boxes[b].r);
            if (x > 6 && x > 0.03 * Math.min(area(boxes[a].r), area(boxes[b].r))) out.push(`overlap: "${boxes[a].text}" × "${boxes[b].text}" (${x.toFixed(0)})`);
          }
          for (const s of keep) {
            const x = inter(boxes[a].r, s.r);
            if (x > 6 && x > 0.2 * area(s.r)) out.push(`covers kept text: "${boxes[a].text}" × ${s.text}`);
          }
          const r = boxes[a].r;
          if (r[0] < -2 || r[2] > pg.w + 2) out.push(`off the page: "${boxes[a].text}"`);
          if (boxes[a].over) out.push(`text overflows its box: "${boxes[a].text}"`);
        }
        return { n: boxes.length, out };
      },
      { i, paperId },
    );
    if (res.missing) continue;
    if (res.out.length) {
      bad++;
      console.log(`✗ ${name} p${i + 1}: ${res.out.length} problem(s)`);
      for (const o of res.out.slice(0, 6)) console.log(`    ${o}`);
      await page.screenshot({ path: `${SHOTS}/overlap-${name}-p${i + 1}.png` });
    }
  }
  const fitted = await page.evaluate(async (paperId) => {
    const db = await new Promise((r) => (indexedDB.open("paper-sunshine").onsuccess = (e) => r(e.target.result)));
    const rec = await new Promise((r) => (db.transaction("models").objectStore("models").get(paperId).onsuccess = (e) => r(e.target.result)));
    return rec.model.pages.filter((p) => p.inkFit).length;
  }, paperId);
  if (process.env.EXPECT_FIT !== undefined && (fitted > 0) !== (process.env.EXPECT_FIT === "1")) {
    console.log(`✗ ${name}: ${fitted} page(s) re-fitted to the scan, expected ${process.env.EXPECT_FIT === "1" ? "some" : "none"}`);
    bad++;
  }
  console.log(`${bad ? "✗" : "✓"} ${name}: ${pageCount} pages, ${bad} with problems, ${fitted} re-fitted to the scan${errors.length ? `, page errors: ${errors.slice(0, 2).join(" | ")}` : ""}`);
  problems += bad + errors.length;
  await ctx.close();
}
await browser.close();
console.log(problems ? `\n${problems} problem page(s)` : "\nall pages clean");
process.exit(problems ? 1 : 0);
