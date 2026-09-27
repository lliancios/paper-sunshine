import { chromium } from "playwright";
const BASE = "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
await page.goto(BASE + "/");
await page.setInputFiles('input[type=file][multiple]', process.env.PDF);
await page.waitForSelector("tbody tr", { timeout: 60000 });
await page.click("tbody tr td:first-child");
await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 60000 });
const id = new URL(page.url()).searchParams.get("id");
// corrupt explanation (answer missing) -> 解釋 tab must still render
await page.evaluate(async (id) => {
  const r = indexedDB.open("paper-sunshine");
  await new Promise((res) => (r.onsuccess = () => {
    const tx = r.result.transaction(["explanations", "quizzes"], "readwrite");
    tx.objectStore("explanations").put({ id: "bad1", paperId: id, kind: "text", page: 0, query: "x", createdAt: Date.now(), updatedAt: Date.now() });
    tx.objectStore("quizzes").put({ paperId: id, questions: null, answers: null, at: Date.now() });
    tx.oncomplete = res;
  }));
}, id);
await page.click('button[title="解釋"]');
await page.waitForTimeout(800);
console.log("explanations tab card?", await page.locator("text=出錯了").count(), "page crashed?", await page.locator("text=This page couldn’t load").count());
await page.click('button[title="測驗"]');
await page.waitForTimeout(800);
console.log("quiz tab error card?", await page.locator("text=「測驗」出錯了").count(), "page crashed?", await page.locator("text=This page couldn’t load").count());
await page.screenshot({ path: `${process.env.SHOTS ?? "/tmp"}/15-boundary.png` });
await page.click('button[title="高亮"]');
await page.waitForTimeout(500);
console.log("switch tab recovers?", await page.locator("text=「測驗」出錯了").count() === 0);
await browser.close();
