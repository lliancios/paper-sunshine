// Step through summary citations from the focus tag; resume the reading position after reopening.
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
await page.waitForTimeout(6000);
const id = new URL(page.url()).searchParams.get("id");
await page.evaluate(async (id) => {
  const md = "## 結論\n第一句 [[1.4]] 第二句 [[2.3]] 第三句 [[3.5]]";
  const r = indexedDB.open("paper-sunshine");
  await new Promise((res) => (r.onsuccess = () => {
    const tx = r.result.transaction("onepagers", "readwrite");
    tx.objectStore("onepagers").put({ paperId: id, md, model: "test", at: Date.now() });
    tx.oncomplete = res;
  }));
}, id);
await page.click('button[title="一頁速覽"]');
await page.waitForSelector(".ps-cite", { timeout: 20000 });
await page.locator(".ps-cite").first().click();
await page.waitForTimeout(900);
const tag = () => page.locator(".ps-focus-tag").first().innerText();
console.log("tag 1:", JSON.stringify(await tag()));
await page.click('.ps-focus-tag button[title="下一個出處"]');
await page.waitForTimeout(900);
console.log("tag 2:", JSON.stringify(await tag()));
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(900);
console.log("tag 3 (arrow key):", JSON.stringify(await tag()));
await page.waitForTimeout(3000); // position saved (debounced)
const saved = await page.evaluate(async (id) => {
  const r = indexedDB.open("paper-sunshine");
  return await new Promise((res) => (r.onsuccess = () => {
    const q = r.result.transaction("papers").objectStore("papers").get(id);
    q.onsuccess = () => res(q.result.readPage);
  }));
}, id);
console.log("saved readPage:", saved);
await page.reload();
await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 60000 });
await page.waitForTimeout(1500);
console.log("resume toast:", await page.locator("text=接續上次閱讀的位置").count(), "page box:", await page.locator('input.tabular-nums, .tabular-nums input').first().inputValue().catch(() => "?"));
console.log("errors", JSON.stringify(errors));
await browser.close();
