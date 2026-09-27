import { chromium } from "playwright";
const SHOTS = process.env.SHOTS;
const BASE = process.env.BASE || "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(BASE + "/");
await page.setInputFiles('input[type=file][multiple]', process.env.PDF);
await page.waitForSelector("tbody tr", { timeout: 60000 });
await page.click("tbody tr td:first-child");
await page.waitForURL(/\/read/);
await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 90000 });
const id = new URL(page.url()).searchParams.get("id");
// wait for pipeline to finish so the auto one-pager doesn't overwrite our fixture
await page.waitForFunction(async (id) => {
  const r = indexedDB.open("paper-sunshine");
  const job = await new Promise((res) => (r.onsuccess = () => {
    const q = r.result.transaction("jobs").objectStore("jobs").get(id);
    q.onsuccess = () => res(q.result);
  }));
  return job?.stage === "done";
}, id, { timeout: 90000 });
await page.waitForTimeout(6000);
// fixture: multi-sid citations the model actually produced
await page.evaluate(async (id) => {
  const md = "## 一句話結論\n結論一句 [[0.1, 0.2, 1.3]]。\n\n| 項目 | 內容 |\n|---|---|\n| 方法 | 焦點團體 [[1.2]][[1.4]] |\n\n單括號 [0.3, 0.4] 與 [連結](https://example.com)";
  const r = indexedDB.open("paper-sunshine");
  await new Promise((res) => (r.onsuccess = () => {
    const tx = r.result.transaction("onepagers", "readwrite");
    tx.objectStore("onepagers").put({ paperId: id, md, model: "test", at: Date.now() });
    tx.oncomplete = res;
  }));
}, id);
await page.click('button[title="一頁速覽"]');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/11a.png` });
console.log("panel text", (await page.evaluate(() => document.querySelector(".ps-onepager")?.textContent ?? "none")).slice(0, 200));
await page.waitForSelector(".ps-cite", { timeout: 10000 });
const chips = await page.$$eval(".ps-cite", (els) => els.map((e) => e.textContent));
console.log("chips", JSON.stringify(chips));
const raw = await page.evaluate(() => document.querySelector(".ps-onepager").textContent.includes("[["));
console.log("raw brackets left", raw);
console.log("chip tooltip:", JSON.stringify((await page.locator(".ps-cite").first().getAttribute("title"))?.slice(0, 120)));
// scroll away first so "回原處" has somewhere to go back to
await page.evaluate(() => document.querySelector("[data-reader-root] > div").scrollTo({ top: 1500 }));
await page.waitForTimeout(500);
const before = await page.evaluate(() => document.querySelector("[data-reader-root] > div").scrollTop);
await page.locator(".ps-cite").nth(1).click();
await page.waitForTimeout(1200);
const focus = await page.evaluate(() => ({ src: document.querySelectorAll(".ps-focus").length, tgt: document.querySelectorAll(".ps-sent.is-focus").length, tag: document.querySelector(".ps-focus-tag")?.textContent, top: document.querySelector("[data-reader-root] > div").scrollTop }));
console.log("focus after chip", JSON.stringify(focus), "scrolled from", before, "panel still open", await page.locator(".ps-onepager").count());
await page.waitForTimeout(2500);
console.log("focus persists after 2.5s", await page.locator(".ps-focus").count() > 0);
await page.screenshot({ path: `${SHOTS}/11-onepager-panel.png` });
await page.click(".ps-focus-tag >> text=回原處");
await page.waitForTimeout(1200);
console.log("after 回原處: focus", await page.locator(".ps-focus").count(), "scrollTop", await page.evaluate(() => document.querySelector("[data-reader-root] > div").scrollTop));
await page.screenshot({ path: `${SHOTS}/11-onepager-panel.png` });
// highlight menu regenerate
await page.locator("button:has(svg.lucide-highlighter)").first().click();
await page.click("text=重新產生這篇的高亮");
await page.waitForSelector("text=/已重新標出/", { timeout: 20000 });
console.log("regen toast ok");
await page.screenshot({ path: `${SHOTS}/12-hlmenu.png` });
console.log("errors", JSON.stringify(errors.slice(0, 5)));
await browser.close();
