// Double-click quick highlight, unified highlights panel (language toggle, filters, categories), lookup menu.
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE + "/");
await page.setInputFiles("input[type=file][multiple]", process.env.PDF);
await page.waitForSelector("tbody tr", { timeout: 60000 });
await page.click("tbody tr td:first-child");
await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 90000 });
await page.waitForTimeout(3000);
const count = () => page.evaluate(async () => {
  const r = indexedDB.open("paper-sunshine");
  const all = await new Promise((res) => (r.onsuccess = () => {
    const q = r.result.transaction("highlights").objectStore("highlights").getAll();
    q.onsuccess = () => res(q.result);
  }));
  return all.filter((h) => !h.deleted).map((h) => `${h.side}:${h.color}:${h.ranges[0].sid}:${h.ranges[0].start}-${h.ranges[0].end}/${h.text.length}`);
});
// double-click on a source sentence
const src = await page.evaluate(() => {
  const sp = [...document.querySelectorAll('[data-side="src"] span[data-start]')].filter((s) => (s.textContent ?? "").length > 40)[12];
  const r = sp.getBoundingClientRect();
  return { x: r.left + 20, y: r.top + r.height / 2, sid: sp.dataset.sid };
});
await page.mouse.dblclick(src.x, src.y);
await page.waitForTimeout(800);
console.log("after src dblclick", JSON.stringify(await count()), "toolbar shown?", await page.locator('[data-popover] button[title^="黃色"]').count());
// double-click on a translated sentence
const tgt = await page.evaluate(() => {
  const s = [...document.querySelectorAll('[data-side="tgt"] [data-sid][data-start]')].filter((x) => (x.textContent ?? "").length > 30)[15];
  const r = s.getClientRects()[0];
  return { x: r.left + 10, y: r.top + r.height / 2, sid: s.dataset.sid };
});
await page.mouse.dblclick(tgt.x, tgt.y);
await page.waitForTimeout(800);
console.log("after tgt dblclick on", tgt.sid, JSON.stringify(await count()));
// panel
await page.click('button[title="高亮"]');
await page.waitForTimeout(600);
const rows = () => page.locator(".divide-y > div.group").count();
console.log("panel rows (mine + auto):", await rows());
await page.click('.sticky button:has-text("自動高亮")');
await page.waitForTimeout(300);
console.log("rows with auto hidden:", await rows());
await page.click('.sticky button:has-text("自動高亮")');
await page.click('.sticky button:has-text("英文")');
await page.waitForTimeout(300);
const first = await page.locator(".divide-y > div.group").first().innerText();
console.log("english-only first row:", JSON.stringify(first.slice(0, 80)));
await page.click('.sticky button:has-text("中英")');
// categorize my first highlight via the select
await page.locator(".divide-y > div.group select").first().selectOption({ index: 1 });
await page.waitForTimeout(500);
console.log("category saved:", JSON.stringify(await page.evaluate(async () => {
  const r = indexedDB.open("paper-sunshine");
  const all = await new Promise((res) => (r.onsuccess = () => {
    const q = r.result.transaction("highlights").objectStore("highlights").getAll();
    q.onsuccess = () => res(q.result);
  }));
  return all.map((h) => h.c ?? null);
})));
await page.screenshot({ path: `${process.env.SHOTS ?? "/tmp"}/18-highlights-panel.png` });
// lookup menu
await page.evaluate(() => {
  const sp = [...document.querySelectorAll('[data-side="src"] span[data-start]')].filter((s) => (s.textContent ?? "").length > 40)[20];
  const r = document.createRange();
  r.setStart(sp.firstChild, 0);
  r.setEnd(sp.firstChild, 12);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
});
await page.waitForSelector('[data-popover] button[title^="查詢"]', { timeout: 5000 });
await page.click('[data-popover] button[title^="查詢"]');
console.log("lookup options:", await page.locator('[data-popover] button:has-text("維基百科")').count());
console.log("errors", JSON.stringify(errors));
await browser.close();
