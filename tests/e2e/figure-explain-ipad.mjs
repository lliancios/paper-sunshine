import { chromium } from "playwright";
const SHOTS = process.env.SHOTS;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
async function open(viewport, touch) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: false, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("http://localhost:3100/");
  await page.setInputFiles('input[type=file][multiple]', process.env.PDF);
  await page.waitForSelector("tbody tr, .grid > div", { timeout: 30000 });
  await page.locator("tbody tr td:first-child, .grid > div").first().click();
  await page.waitForURL(/\/read/);
  await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 60000 });
  await page.waitForTimeout(2500);
  return page;
}
// desktop: figure + explain
const d = await open({ width: 1600, height: 1000 }, false);
await d.screenshot({ path: `${SHOTS}/6-zh.png` });
await d.locator("[data-row='1']").first().scrollIntoViewIfNeeded();
await d.waitForTimeout(800);
await d.locator("text=解讀這張圖").first().click();
await d.waitForSelector("text=研究概念模型分析", { timeout: 10000 });
await d.waitForSelector('[data-popover] img[alt="選取的圖"]', { timeout: 20000 });
await d.click("button:has-text('研究概念模型分析')");
await d.waitForTimeout(2500);
await d.screenshot({ path: `${SHOTS}/7-figure.png` });
const exCount = await d.evaluate(async () => {
  const r = indexedDB.open("paper-sunshine");
  return await new Promise((res) => (r.onsuccess = () => {
    const tx = r.result.transaction("explanations").objectStore("explanations").count();
    tx.onsuccess = () => res(tx.result);
  }));
});
console.log("explanations saved", exCount);
await d.keyboard.press("Escape");
// explain on translated side via keyboard E
await d.evaluate(() => {
  const seg = [...document.querySelectorAll('[data-side="tgt"] [data-sid][data-start]')].filter((s) => (s.textContent ?? "").length > 20)[2];
  const r = document.createRange();
  r.setStart(seg.firstChild, 2);
  r.setEnd(seg.firstChild, 12);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
});
await d.waitForTimeout(400);
await d.keyboard.press("e");
await d.waitForTimeout(1800);
console.log("explain popover", await d.locator("text=在討論中追問").count());
await d.screenshot({ path: `${SHOTS}/8-explain.png` });
// iPad portrait
const ip = await open({ width: 1024, height: 1366 }, true);
await ip.screenshot({ path: `${SHOTS}/9-ipad.png` });
const sid = await ip.evaluate(() => document.querySelectorAll('[data-side="tgt"] [data-sent]')[8].dataset.sent);
const box = await ip.evaluate((sid) => {
  const r = document.querySelector(`[data-side="tgt"] [data-sent="${sid}"]`).getClientRects()[0];
  return { x: r.left + 5, y: r.top + r.height / 2 };
}, sid);
await ip.touchscreen.tap(box.x, box.y);
await ip.waitForTimeout(400);
console.log("ipad tap pins", sid, "srcHover", await ip.evaluate(() => document.querySelectorAll(".ps-hover").length));
console.log("errors", JSON.stringify(errors.slice(0, 6)));
await browser.close();
