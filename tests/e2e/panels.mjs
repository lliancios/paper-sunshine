import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 600)));
page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text().slice(0, 600)));
await page.goto(BASE + "/");
await page.setInputFiles('input[type=file][multiple]', process.env.PDF);
await page.waitForSelector("tbody tr", { timeout: 60000 });
await page.click("tbody tr td:first-child");
await page.waitForURL(/\/read/);
await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 90000 });
await page.waitForTimeout(2000);
await page.click('button[title="與 AI 一起"]');
await page.waitForTimeout(800);
for (const label of ["關鍵詞詞典", "討論", "摘要", "討論"]) {
  await page.click(`button:has-text("${label}")`);
  await page.waitForTimeout(800);
  console.log("clicked", label, "crashed?", await page.locator("text=This page couldn’t load").count());
}
await page.fill("textarea", "這篇的研究限制是什麼？");
await page.keyboard.press("Enter");
await page.waitForTimeout(3000);
console.log("after send crashed?", await page.locator("text=This page couldn’t load").count(), "bubbles", await page.locator(".ps-md").count());
for (const t of ["測驗", "高亮", "解釋", "評論", "筆記", "引用卡片", "一頁速覽"]) {
  await page.click(`button[title="${t}"]`);
  await page.waitForTimeout(700);
  console.log("tab", t, "crashed?", await page.locator("text=This page couldn’t load").count());
}
await page.screenshot({ path: `${process.env.SHOTS ?? "/tmp"}/13-chat.png` });
await browser.close();
