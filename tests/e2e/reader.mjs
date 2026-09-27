import { chromium } from "playwright";
const SHOTS = process.env.SHOTS;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("http://localhost:3100/");
await page.waitForSelector("text=文獻庫");
await page.setInputFiles('input[type=file][multiple]', process.env.PDF);
await page.waitForSelector("tbody tr", { timeout: 30000 });
await page.screenshot({ path: `${SHOTS}/1-library.png` });
await page.click("tbody tr td:first-child");
await page.waitForURL(/\/read/);
await page.waitForSelector('[data-side="tgt"] .ps-tblock', { timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/2-reader.png` });
const counts = await page.evaluate(() => ({
  srcSpans: document.querySelectorAll('[data-side="src"] span[data-start]').length,
  tgtBlocks: document.querySelectorAll('[data-side="tgt"] .ps-tblock').length,
  tgtSegs: document.querySelectorAll('[data-side="tgt"] [data-sid][data-start]').length,
  autoMarks: document.querySelectorAll('.ps-marks .ps-mark').length,
}));
console.log("counts", JSON.stringify(counts));

// 1) highlight on the TRANSLATED side
const tgtSid = await page.evaluate(() => {
  const segs = [...document.querySelectorAll('[data-side="tgt"] [data-sid][data-start]')].filter((s) => (s.textContent ?? "").length > 40);
  const seg = segs[3];
  const tn = seg.firstChild;
  const r = document.createRange();
  r.setStart(tn, 8);
  r.setEnd(tn, 26);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  return seg.dataset.sid;
});
await page.waitForSelector('[data-popover] button[title^="黃色"]', { timeout: 5000 });
await page.screenshot({ path: `${SHOTS}/3-toolbar.png` });
await page.click('[data-popover] button[title^="黃色"]');
await page.waitForTimeout(600);
const mirrored = await page.evaluate((sid) => {
  const marks = [...document.querySelectorAll('.ps-marks > div')].filter((d) => (d.getAttribute("style") ?? "").includes("dashed"));
  const tgtSeg = [...document.querySelectorAll(`[data-side="tgt"] [data-sid="${sid}"][data-start]`)].map((s) => [s.dataset.start, s.textContent?.length, s.getAttribute("style")?.includes("background-color")]);
  return { dashedSrcMarks: marks.length, tgtSegments: tgtSeg };
}, tgtSid);
console.log("after tgt highlight", tgtSid, JSON.stringify(mirrored));

// 2) highlight on the SOURCE side
const srcSid = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('[data-side="src"] span[data-start]')].filter((s) => (s.textContent ?? "").length > 30);
  const sp = spans[10];
  const r = document.createRange();
  r.setStart(sp.firstChild, 0);
  r.setEnd(sp.firstChild, 15);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  return sp.dataset.sid;
});
await page.waitForSelector('[data-popover] button[title^="綠色"]', { timeout: 5000 });
await page.click('[data-popover] button[title^="綠色"]');
await page.waitForTimeout(600);
const srcRes = await page.evaluate((sid) => {
  const sent = document.querySelector(`[data-side="tgt"] [data-sent="${sid}"]`);
  return { tgtSentenceStyle: sent?.getAttribute("style") ?? "(not on screen)" };
}, srcSid);
console.log("after src highlight", srcSid, JSON.stringify(srcRes));

// 3) hover sync: hover a translated sentence, expect .ps-hover on the source side
const box = await page.evaluate(() => {
  const s = document.querySelectorAll('[data-side="tgt"] [data-sent]')[6];
  const r = s.getClientRects()[0];
  return { x: r.left + 6, y: r.top + 6, sid: s.dataset.sent };
});
await page.mouse.move(box.x, box.y);
await page.waitForTimeout(300);
const hover = await page.evaluate(() => document.querySelectorAll(".ps-hover").length);
console.log("hover", box.sid, "srcHoverRects", hover);
await page.screenshot({ path: `${SHOTS}/4-synced.png` });

// 4) click on the translated highlight opens the popover
const hl = await page.evaluate((sid) => {
  const s = [...document.querySelectorAll(`[data-side="tgt"] [data-sid="${sid}"][data-start]`)].find((x) => x.getAttribute("style")?.includes("background-color"));
  const r = s.getClientRects()[0];
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, tgtSid);
await page.mouse.click(hl.x, hl.y);
await page.waitForTimeout(400);
console.log("popover open", await page.locator('textarea[placeholder="寫下評論…"]').count());

// 5) right panel highlights list
await page.click('button[title="高亮"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/5-panel.png` });
console.log("panel items", await page.locator("text=譯文劃線").count(), await page.locator("text=原文劃線").count());
console.log("errors", JSON.stringify(errors.slice(0, 8)));
await browser.close();
