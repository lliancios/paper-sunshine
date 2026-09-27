// Sync diagnostics and repair buttons: device A has a library, signs up; device B signs in and checks.
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3100";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const errors = [];
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${String(e).slice(0, 200)}`));
  return page;
}
async function signIn(page, create) {
  await page.getByRole("button", { name: "設定" }).first().click();
  await page.click("text=跨裝置同步");
  await page.fill("input[type=email]", "diag@test.dev");
  await page.fill('input[placeholder^="密碼"]', "secret123");
  await page.click(create ? 'button:has-text("建立帳號")' : 'button[type=submit]:has-text("登入")');
  await page.waitForSelector("text=登出", { timeout: 20000 });
}
const A = await device("A");
await A.goto(BASE + "/");
console.log("A hint before sign-in:", await A.locator("text=登入同步帳號，就能看到").count());
await A.setInputFiles("input[type=file][multiple]", process.env.PDF);
await A.waitForSelector("tbody tr", { timeout: 60000 });
await A.waitForTimeout(4000);
await signIn(A, true);
await A.waitForTimeout(4000);
await A.click("text=開始檢查");
await A.waitForSelector("text=建議", { timeout: 20000 });
console.log("A diagnose:\n" + (await A.locator("ul.space-y-1\\.5").innerText()));
const B = await device("B");
await B.goto(BASE + "/");
await signIn(B, false);
await B.click("text=從雲端重新下載全部");
await B.waitForTimeout(4000);
await B.click("text=開始檢查");
await B.waitForSelector("text=建議", { timeout: 20000 });
console.log("B diagnose:\n" + (await B.locator("ul.space-y-1\\.5").innerText()));
console.log("errors", JSON.stringify(errors));
await browser.close();
