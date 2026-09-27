import { chromium } from "playwright";
const BASE = "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE + "/");
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return reg.active?.scriptURL;
});
console.log("sw active", sw);
await page.waitForTimeout(1500);
const cached = await page.evaluate(async () => {
  const out = {};
  for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).length;
  return out;
});
console.log("caches", JSON.stringify(cached));
await page.setInputFiles('input[type=file][multiple]', process.env.PDF);
await page.waitForSelector("tbody tr", { timeout: 60000 });
const id = await page.evaluate(async () => {
  const r = indexedDB.open("paper-sunshine");
  const all = await new Promise((res) => (r.onsuccess = () => {
    const q = r.result.transaction("papers").objectStore("papers").getAll();
    q.onsuccess = () => res(q.result);
  }));
  return all[0].id;
});
await page.waitForTimeout(3000); // let the background job finish
// Go offline and open the reader directly (never visited in this context)
await ctx.setOffline(true);
await page.goto(`${BASE}/read?id=${id}`);
await page.waitForSelector('[data-side="src"] span[data-start]', { timeout: 30000 });
await page.waitForTimeout(1500);
const state = await page.evaluate(() => ({
  canvases: [...document.querySelectorAll("canvas")].filter((c) => c.width > 0).length,
  tgtBlocks: document.querySelectorAll('[data-side="tgt"] .ps-tblock').length,
  banner: document.body.innerText.includes("離線中"),
}));
console.log("offline reader", JSON.stringify(state));
await page.screenshot({ path: `${process.env.SHOTS ?? "/tmp"}/14-offline.png` });
await page.goto(`${BASE}/`);
await page.waitForSelector("tbody tr", { timeout: 20000 });
console.log("offline library ok");
// legacy URL offline
await page.goto(`${BASE}/read/${id}`);
await page.waitForSelector('[data-side="src"] span[data-start]', { timeout: 30000 });
console.log("offline legacy url ok");
await ctx.setOffline(false);
console.log("errors", JSON.stringify(errors.slice(0, 5)));
await browser.close();
