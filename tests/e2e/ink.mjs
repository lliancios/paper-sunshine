import { chromium } from "playwright";
const SHOTS = process.env.SHOTS;
const BASE = process.env.BASE || "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(BASE + "/");
await page.setInputFiles('input[type=file][multiple]', process.env.PDF);
await page.waitForSelector("tbody tr", { timeout: 60000 });
await page.click("tbody tr td:first-child");
await page.waitForURL(/\/read/);
console.log("url", page.url());
await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 90000 });
await page.waitForTimeout(1500);
await page.click('button[title^="手寫"]');
await page.waitForSelector("text=完成");
const box = await page.evaluate(() => {
  const r = document.querySelector('[data-row="0"] svg.ps-ink').getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
// mouse stroke on source page 1
await page.mouse.move(box.x + box.w * 0.2, box.y + box.h * 0.5);
await page.mouse.down();
for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.w * (0.2 + i * 0.02), box.y + box.h * (0.5 + Math.sin(i / 3) * 0.02));
await page.mouse.up();
await page.waitForTimeout(500);
// synthetic Apple Pencil stroke on translated page 1
await page.evaluate(() => {
  const svg = document.querySelectorAll('[data-row="0"] svg.ps-ink')[1];
  const r = svg.getBoundingClientRect();
  const ev = (type, i) =>
    svg.dispatchEvent(new PointerEvent(type, { pointerType: "pen", pointerId: 7, isPrimary: true, bubbles: true, cancelable: true, pressure: 0.3 + i * 0.03, clientX: r.left + r.width * (0.3 + i * 0.015), clientY: r.top + r.height * 0.3 }));
  ev("pointerdown", 0);
  for (let i = 1; i < 20; i++) ev("pointermove", i);
  ev("pointerup", 20);
});
await page.waitForTimeout(600);
const count = async () =>
  page.evaluate(async () => {
    const r = indexedDB.open("paper-sunshine");
    const all = await new Promise((res) => (r.onsuccess = () => {
      const q = r.result.transaction("ink").objectStore("ink").getAll();
      q.onsuccess = () => res(q.result);
    }));
    return { live: all.filter((s) => !s.deleted).length, total: all.length, paths: document.querySelectorAll('[data-row="0"] svg.ps-ink path[d]:not([d=""])').length, sides: all.map((s) => s.side + ":" + s.tool + ":" + s.pts.length / 3) };
  });
console.log("after draw", JSON.stringify(await count()));
await page.screenshot({ path: `${SHOTS}/10-ink.png` });
// marker + eraser + undo
await page.click('button[title="橡皮擦（劃過就刪除整筆）"]');
await page.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.45);
await page.mouse.down();
await page.mouse.move(box.x + box.w * 0.3, box.y + box.h * 0.55, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);
console.log("after erase", JSON.stringify(await count()));
await page.keyboard.press("Control+z");
await page.waitForTimeout(400);
console.log("after undo", JSON.stringify(await count()));
await page.click("text=完成");
await page.waitForTimeout(300);
const pe = await page.evaluate(() => getComputedStyle(document.querySelector("svg.ps-ink")).pointerEvents);
console.log("pointer-events after done", pe, "toolbar gone", await page.locator("text=完成").count());
console.log("errors", JSON.stringify(errors.slice(0, 5)));
await browser.close();
