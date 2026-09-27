import { chromium } from "playwright";
const BASE = "http://localhost:3100";
const SB = "http://localhost:54321";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
const debug = async () => (await fetch(SB + "/__debug")).json();
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${String(e).slice(0, 300)}`));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !/WebSocket|realtime|websocket/i.test(t)) errors.push(`${name}: ${t.slice(0, 300)}`);
  });
  const ai = [];
  page.on("request", (r) => r.url().includes("/api/ai/") && ai.push(r.url().split("/api/ai/")[1]));
  return { ctx, page, ai };
}
async function openSync(page) {
  await page.getByRole("button", { name: "設定" }).first().click();
  await page.click("text=跨裝置同步");
}
async function idb(page, store) {
  return page.evaluate(async (store) => {
    const r = indexedDB.open("paper-sunshine");
    return await new Promise((res) => (r.onsuccess = () => {
      const q = r.result.transaction(store).objectStore(store).getAll();
      q.onsuccess = () => res(q.result);
    }));
  }, store);
}
const waitIdle = (page) => page.waitForFunction(async () => {
  const r = indexedDB.open("paper-sunshine");
  const n = await new Promise((res) => (r.onsuccess = () => {
    const q = r.result.transaction("outbox").objectStore("outbox").count();
    q.onsuccess = () => res(q.result);
  }));
  return n === 0;
}, null, { timeout: 60000, polling: 1000 });

// ---------------- Device A: sign up, import, annotate
const A = await device("A");
await A.page.goto(BASE + "/");
await A.page.waitForSelector("text=文獻庫");
await A.page.setInputFiles('input[type=file][multiple]', process.env.PDF);
await A.page.waitForSelector("tbody tr", { timeout: 60000 });
await A.page.click("tbody tr td:first-child");
await A.page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 90000 });
const paperId = new URL(A.page.url()).searchParams.get("id");
// highlight on the translated side
await A.page.evaluate(() => {
  const seg = [...document.querySelectorAll('[data-side="tgt"] [data-sid][data-start]')].filter((s) => (s.textContent ?? "").length > 40)[3];
  const r = document.createRange();
  r.setStart(seg.firstChild, 4);
  r.setEnd(seg.firstChild, 20);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
});
await A.page.waitForSelector('[data-popover] button[title^="黃色"]');
await A.page.click('[data-popover] button[title^="黃色"]');
// ink stroke
await A.page.click('button[title^="手寫"]');
const box = await A.page.evaluate(() => {
  const r = document.querySelector('[data-row="0"] svg.ps-ink').getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
await A.page.mouse.move(box.x + box.w * 0.2, box.y + box.h * 0.6);
await A.page.mouse.down();
await A.page.mouse.move(box.x + box.w * 0.6, box.y + box.h * 0.62, { steps: 12 });
await A.page.mouse.up();
await A.page.click("text=完成");
// wait for the pipeline and push to drain
await A.page.waitForFunction(async (id) => {
  const r = indexedDB.open("paper-sunshine");
  const job = await new Promise((res) => (r.onsuccess = () => {
    const q = r.result.transaction("jobs").objectStore("jobs").get(id);
    q.onsuccess = () => res(q.result);
  }));
  return job?.stage === "done";
}, paperId, { timeout: 90000 });
// Existing library, then the first sign-in uploads everything.
await A.page.goto(BASE + "/");
await A.page.waitForSelector("tbody tr");
await openSync(A.page);
await A.page.fill('input[type=email]', "liang@test.dev");
await A.page.fill('input[placeholder^="密碼"]', "secret123");
await A.page.click(`button:has-text("建立帳號")`);
await A.page.waitForSelector("text=登出", { timeout: 20000 });
console.log("A signed in");
await A.page.keyboard.press("Escape");
await A.page.waitForTimeout(3500);
await waitIdle(A.page);
let d = await debug();
console.log("cloud after A:", d.records.length, "records;", JSON.stringify(d.records.map((r) => r.split(":")[0]).reduce((m, t) => ((m[t] = (m[t] ?? 0) + 1), m), {})), "files:", d.files.map((f) => f.split("/").pop()));
console.log("A AI calls:", A.ai.length);

// ---------------- Device B: sign in, read the same paper
const B = await device("B");
await B.page.goto(BASE + "/");
await B.page.waitForSelector("text=文獻庫");
await openSync(B.page);
await B.page.fill('input[type=email]', "liang@test.dev");
await B.page.fill('input[placeholder^="密碼"]', "secret123");
await B.page.click('button[type=submit]:has-text("登入")');
await B.page.waitForSelector("text=登出", { timeout: 20000 });
await B.page.keyboard.press("Escape");
await B.page.waitForSelector("tbody tr", { timeout: 30000 });
console.log("B library rows:", await B.page.locator("tbody tr").count());
await B.page.waitForTimeout(3000); // background prefetch of recent PDFs
const bFiles = await idb(B.page, "files");
console.log("B prefetched files:", bFiles.length);
await B.page.click("tbody tr td:first-child");
await B.page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 60000 });
await B.page.waitForTimeout(2500);
const bState = await B.page.evaluate(() => ({
  tgtSegsWithBg: [...document.querySelectorAll('[data-side="tgt"] [data-sid][data-start]')].filter((s) => (s.getAttribute("style") ?? "").includes("background-color")).length,
  inkPaths: document.querySelectorAll('svg.ps-ink path[d]:not([d=""])').length,
  tgtBlocks: document.querySelectorAll('[data-side="tgt"] .ps-tblock').length,
  canvases: [...document.querySelectorAll("canvas")].filter((c) => c.width > 0).length,
}));
console.log("B reader:", JSON.stringify(bState));
console.log("B AI calls (should be 0 translate/json):", JSON.stringify(B.ai));
const bHl = (await idb(B.page, "highlights")).filter((h) => !h.deleted);
console.log("B highlights:", bHl.length, "B translations:", (await idb(B.page, "translations")).length, "B autohl:", (await idb(B.page, "autohl")).length);

// ---------------- B deletes the highlight; A sees it after a sync
await B.page.evaluate(async (id) => {
  const r = indexedDB.open("paper-sunshine");
  await new Promise((res) => (r.onsuccess = () => res()));
}, null);
await B.page.click('button[title="高亮"]');
await B.page.waitForTimeout(500);
await B.page.locator(".group").first().hover();
await B.page.locator('[title="刪除"]').first().click().catch(() => console.log("no delete button in panel"));
await B.page.waitForTimeout(3500);
await waitIdle(B.page);
await A.page.reload();
await A.page.waitForSelector("tbody tr", { timeout: 60000 });
await A.page.waitForTimeout(3000);
const aHl = (await idb(A.page, "highlights")).filter((h) => !h.deleted);
console.log("A highlights after B deleted:", aHl.length);

// ---------------- A deletes the paper; B loses it
await A.page.goto(BASE + "/");
await A.page.waitForSelector("tbody tr");
A.page.on("dialog", (dlg) => dlg.accept());
await A.page.locator("tbody tr").first().hover();
await A.page.locator('tbody tr button[title="刪除"]').first().click();
await A.page.waitForTimeout(3500);
await waitIdle(A.page);
d = await debug();
console.log("cloud after delete:", JSON.stringify(d.records), "files:", d.files.length);
await B.page.goto(BASE + "/");
await B.page.waitForTimeout(3000);
console.log("B library rows after delete:", await B.page.locator("tbody tr").count());
console.log("errors", JSON.stringify(errors.slice(0, 8), null, 1));
await browser.close();
