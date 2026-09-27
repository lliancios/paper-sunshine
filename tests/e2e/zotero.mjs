// Zotero import (triage mode) and saving notes back, against fake-zotero.mjs.
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3100";
const ZOT = process.env.ZOT || "http://localhost:54322";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE + "/");
await page.waitForSelector("text=文獻庫");
await page.click('button[title="更多"]');
await page.click("text=從 Zotero 匯入");
await page.fill('input[placeholder="Zotero API 金鑰"]', "TESTKEY1234567890abcd");
await page.click('button:has-text("連結")');
await page.waitForSelector("text=已連結 Zotero", { timeout: 15000 });
await page.click('nav button:has-text("Hoarded")');
await page.waitForSelector("text=Only metadata here", { timeout: 15000 });
console.log("items listed:", await page.locator("label:has(input[type=checkbox]) .line-clamp-2").count());
await page.click('button:has-text("匯入 3 篇")');
await page.waitForSelector("text=完成 2", { timeout: 60000 });
console.log("summary:", await page.locator("text=/完成 \\d+/").first().innerText());
await page.click('button:has-text("完成")');
await page.waitForTimeout(500);
console.log("folder created:", await page.locator("text=Zotero｜Hoarded").count() > 0);
console.log("rows:", await page.locator("tbody tr").count(), "needs pdf:", await page.locator("text=需要 PDF").count());
// triage: summaries appear in the library without full translation
await page.waitForFunction(async () => {
  const r = indexedDB.open("paper-sunshine");
  const n = await new Promise((res) => (r.onsuccess = () => {
    const q = r.result.transaction("onepagers").objectStore("onepagers").count();
    q.onsuccess = () => res(q.result);
  }));
  return n >= 2;
}, null, { timeout: 90000, polling: 1000 });
await page.waitForTimeout(800);
const stats = await page.evaluate(async () => {
  const r = indexedDB.open("paper-sunshine");
  const db = await new Promise((res) => (r.onsuccess = () => res(r.result)));
  const get = (s) => new Promise((res) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); });
  const papers = await get("papers");
  const trans = await get("translations");
  return { triage: papers.filter((p) => p.triage).length, zotero: papers.filter((p) => p.zotero).length, translations: trans.length };
});
console.log("after triage:", JSON.stringify(stats), "conclusion lines:", await page.locator('[title="一頁速覽的一句話結論"]').count(), "unread chip:", await page.locator("text=/未讀 \\d+/").count());
// open the first paper: triage cleared, translation starts
await page.locator("tbody tr td:first-child").filter({ hasText: "Recovery" }).first().click();
await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 60000 });
await page.waitForTimeout(4000);
const after = await page.evaluate(async () => {
  const r = indexedDB.open("paper-sunshine");
  const db = await new Promise((res) => (r.onsuccess = () => res(r.result)));
  const q = db.transaction("translations").objectStore("translations").count();
  return await new Promise((res) => (q.onsuccess = () => res(q.result)));
});
console.log("translations after opening:", after);
// double-click a sentence, then save back to Zotero
const s = await page.evaluate(() => {
  const sp = [...document.querySelectorAll('[data-side="src"] span[data-start]')].filter((x) => (x.textContent ?? "").length > 40)[10].getBoundingClientRect();
  return { x: sp.left + 15, y: sp.top + sp.height / 2 };
});
await page.mouse.dblclick(s.x, s.y);
await page.waitForTimeout(600);
await page.click('button[title="匯出"]');
await page.click("text=存回 Zotero");
await page.waitForSelector("text=/已在 Zotero|已更新 Zotero/", { timeout: 15000 });
await page.waitForTimeout(500);
await page.click('button[title="匯出"]');
await page.click("text=存回 Zotero");
await page.waitForSelector("text=已更新 Zotero 裡的筆記", { timeout: 15000 });
const notes = await (await fetch(ZOT + "/__notes")).json();
console.log("zotero notes:", notes.length, "parent:", notes[0]?.parentItem, "has highlight:", /我的劃線/.test(notes[0]?.note ?? ""), "has summary:", /一頁速覽/.test(notes[0]?.note ?? ""), "version:", notes[0]?.version);
console.log("errors", JSON.stringify(errors));
await browser.close();
