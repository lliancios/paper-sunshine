// Engine tests: `npm test`. Runs pdf.js in Node against a generated fixture and
// any PDFs placed in tests/fixtures/.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractDocModel, type PdfDoc } from "../src/engine/extract";
import { splitSentences } from "../src/engine/sentences";
import { rectsForRange } from "../src/engine/geometry";
import { makeFixture } from "./make-fixture";
import type { DocModel } from "../src/engine/types";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}`, detail ?? "");
  }
}

async function load(path: string): Promise<DocModel> {
  const data = new Uint8Array(readFileSync(path));
  const pdf = await getDocument({ data, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  return extractDocModel(pdf as unknown as PdfDoc);
}

function sentencesTest() {
  console.log("splitSentences");
  const t =
    'Schaufeli et al. (2002) defined it (Maslach et al., 2001, p. 417). Second, it is related (c.f. Edwards & Rothbard, 2000). Figure 1 presents S. Sonnentag\'s model, e.g. the paths. "Quoted." Next one? Yes! 恢復很重要。下一句。';
  const r = splitSentences(t).map(([a, b]) => t.slice(a, b));
  check("keeps et al./p./c.f./e.g./initials inside sentences", r[0].startsWith("Schaufeli et al. (2002)") && r[0].endsWith("p. 417)."), r);
  check("splits normal boundaries", r[1] === "Second, it is related (c.f. Edwards & Rothbard, 2000).", r);
  check("handles quotes, ? and !", r.includes('"Quoted."') && r.includes("Next one?") && r.includes("Yes!"), r);
  check("splits CJK", r.includes("恢復很重要。") && r.includes("下一句。"), r);
}

async function fixtureTest() {
  console.log("two-column fixture");
  const path = "tests/fixtures/two-column.pdf";
  await makeFixture(path);
  const m = await load(path);
  const all = m.order.map((id) => m.sentences[id]);
  const texts = all.map((s) => s.text);
  check("has 3+ pages", m.pages.length >= 3, m.pages.length);
  check("finds DOI from metadata", m.info.doi === "10.1037/0021-9010.88.3.518", m.info.doi);
  check("guesses title", (m.info.title ?? "").startsWith("Recovery, Work Engagement"), m.info.title);
  check("detects page offset 518", m.info.pageOffset === 518, m.info.pageNumbers);
  const footer = texts.some((t) => t.includes("This content downloaded"));
  check("drops JSTOR boilerplate", !footer);
  check("drops running header", !texts.some((t) => t.startsWith("RECOVERY AND WORK ENGAGEMENT")));
  check("de-hyphenates increas-/ing", texts.some((t) => t.includes("There is increasing empirical evidence")), texts.find((t) => t.includes("increas")));
  const h1 = all.find((s) => s.text === "Effects of Recovery");
  const h2 = all.find((s) => s.text === "Work Engagement");
  check("centred heading is its own unit", h1?.kind === "heading", h1);
  check("italic subheading is its own unit", h2?.kind === "heading", h2);
  const cap = all.find((s) => s.text.startsWith("Figure 1."));
  check("caption detected", cap?.kind === "caption", cap);
  const label = all.find((s) => s.text === "Day-Level Work Engagement");
  check("figure labels kept as units", !!label && label.kind !== "para", label);
  const spec = all.find((s) => s.text.startsWith("Specifically, the study investigates"));
  check("c.f. does not split", !!spec && spec.text.endsWith("(c.f. Edwards & Rothbard, 2000)."), spec?.text);
  const multiPage = all.filter((s) => new Set(s.pieces.map((p) => p.p)).size > 1);
  const multiCol = all.filter((s) => {
    const xs = s.pieces.map((p) => p.r[0]);
    return Math.max(...xs) - Math.min(...xs) > 250 && new Set(s.pieces.map((p) => p.p)).size === 1;
  });
  check("some sentence continues across pages", multiPage.length > 0);
  check("some sentence continues across columns", multiCol.length > 0);
  const abs = all.find((s) => s.text.startsWith("A total of 147 employees"));
  check("abstract sentence intact", !!abs && abs.text.endsWith("5 consecutive work days."), abs?.text);
  // offsets are consistent with pieces
  let bad = 0;
  for (const s of all) for (const pc of s.pieces) if (pc.s < 0 || pc.e > s.text.length || pc.s >= pc.e) bad++;
  check("piece offsets valid", bad === 0, bad);
  // geometry: a sub-range yields rects inside the sentence box
  const r = abs ? rectsForRange(abs, 0, 11, abs.p) : [];
  check("rectsForRange returns a rect", r.length === 1 && r[0][2] > r[0][0], r);
  // every block's sids point to sentences on that page
  let orphan = 0;
  for (const pg of m.pages) for (const b of pg.blocks) for (const sid of b.sids) if (m.sentences[sid]?.b !== b.id) orphan++;
  check("block.sids consistent", orphan === 0, orphan);
  const size = JSON.stringify(m).length;
  const firstSid = m.order[0];
  check("sentence ids are page.n", /^\d+\.\d+$/.test(firstSid), firstSid);
  console.log(`  model: ${all.length} sentences, ${(size / 1024).toFixed(0)} KB`);
}

// Regression checks for real papers (local only; PDFs are gitignored).
const REAL: Record<string, (m: DocModel) => void> = {
  "pps.pdf": (m) => {
    check("pps: printed page offset 70", m.info.pageOffset === 70, m.info.pageOffset);
    const all = m.order.map((id) => m.sentences[id].text);
    check("pps: footnote not merged into body sentence", all.some((t) => t.startsWith("Thus, a key question of interest to managers")));
    check("pps: author bio is its own sentence", all.some((t) => t.startsWith("Goutam Challagalla is Brady Family Professor")));
  },
  "cc.pdf": (m) => {
    check("cc: printed page offset 75 (JSTOR cover page)", m.info.pageOffset === 75, m.info.pageOffset);
    const all = m.order.map((id) => m.sentences[id].text);
    check("cc: running headers skipped", !all.some((t) => /Journal of Marketing, April 2003/.test(t) && t.length < 60));
    check("cc: JSTOR boilerplate skipped", !all.some((t) => /collaborating with JSTOR|Accessibility support/.test(t)));
  },
  "sonnentag.pdf": (m) => {
    check("sonnentag: printed page offset 518", m.info.pageOffset === 518, m.info.pageOffset);
  },
};

async function extraFixtures() {
  const dir = "tests/fixtures";
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".pdf") || f === "two-column.pdf") continue;
    const t0 = Date.now();
    const m = await load(`${dir}/${f}`);
    const cjkSpace = m.order.filter((id) => m.sentences[id].kind === "para" && /[\u4e00-\u9fff] [\u4e00-\u9fff]/.test(m.sentences[id].text)).length;
    check(`${f}: no spaces between CJK characters`, cjkSpace === 0, cjkSpace);
    REAL[f]?.(m);
    const kinds: Record<string, number> = {};
    for (const id of m.order) kinds[m.sentences[id].kind] = (kinds[m.sentences[id].kind] ?? 0) + 1;
    console.log(`  ${f}: ${m.pages.length} pages, ${m.order.length} sentences ${JSON.stringify(kinds)} in ${Date.now() - t0} ms`);
    if (process.env.DUMP) for (const id of m.order.slice(0, Number(process.env.DUMP))) console.log(`    [${id}|${m.sentences[id].kind}] ${m.sentences[id].text.slice(0, 110)}`);
  }
}

async function main() {
  sentencesTest();
  await fixtureTest();
  await extraFixtures();
  if (failures) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nall engine tests passed");
}
main();
