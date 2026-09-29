// Engine tests: `npm test`. Runs pdf.js in Node against a generated fixture and
// any PDFs placed in tests/fixtures/.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { extractDocModel, type PdfDoc } from "../src/engine/extract";
import { splitSentences } from "../src/engine/sentences";
import { rectsForRange } from "../src/engine/geometry";
import { lineOf } from "../src/engine/lines";
import { buildOutline } from "../src/engine/outline";
import { makeFixture } from "./make-fixture";
import { cleanTranslation, isUntranslatedEcho, stripEcho } from "../src/lib/cleanTranslation";
import { layoutBoxes, overlappingBoxes } from "../src/engine/boxes";
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
  const f = "They build long-term relationships with their customers.1 Yet if the business press is right, it works. See section 3.1 The end.";
  const rf = splitSentences(f).map(([a, b]) => f.slice(a, b));
  check("splits after a footnote marker", rf[0] === "They build long-term relationships with their customers.1" && rf[1].startsWith("Yet if"), rf);
  check("does not split section numbers", rf.some((s) => s.startsWith("See section 3.1 The end")), rf);
  const o = "Firms build relationships with their customers) Yet if the press (Smith 2001) Some say is right, it works.";
  const ro = splitSentences(o).map(([a, b]) => o.slice(a, b));
  check("OCR ')' for '.1' ends a sentence, matched parentheses do not", ro.length === 2 && ro[0].endsWith("customers)") && ro[1].includes("(Smith 2001) Some say"), ro);
}

function cleanTest() {
  console.log("cleanTranslation");
  const zh = "繁體中文（台灣）";
  const src = "In addition, we draw on the study interviews with managers to develop guidelines for averting the problems identified and note examples of effective implementation (see Table 4).";
  const echo = `${src} 此外，我們藉由本研究對經理人的訪談，發展出用以避免所識別問題的指導原則（參見 Table 4）。`;
  check("strips an echoed English sentence", cleanTranslation(src, echo, zh) === "此外，我們藉由本研究對經理人的訪談，發展出用以避免所識別問題的指導原則（參見 Table 4）。", cleanTranslation(src, echo, zh));
  const near = src.replace("study interviews", "interviews").replace("(see Table 4).", "(Table 4)") + " 此外，我們藉由訪談發展指導原則。";
  check("strips a slightly different echo", cleanTranslation(src, near, zh) === "此外，我們藉由訪談發展指導原則。", cleanTranslation(src, near, zh));
  check("keeps the English（中文） glossary format", cleanTranslation("Motive uncertainty", "Motive uncertainty（動機不確定性）", zh) === "Motive uncertainty（動機不確定性）");
  check("strips an echoed label", cleanTranslation("Motive uncertainty", "Motive uncertainty 動機不確定性", zh) === "動機不確定性");
  check("takes the translated field of id/EN/ZH output", cleanTranslation("Health care", "Health care\t醫療保健", zh) === "醫療保健");
  check("dedupes a repeated caption", cleanTranslation("TABLE 4", "TABLE 4 TABLE 4", zh) === "TABLE 4");
  check("leaves a normal translation alone", cleanTranslation(src, "此外，我們也藉由訪談。", zh) === "此外，我們也藉由訪談。");
  check("leaves a translation that starts with a name alone", cleanTranslation("Bhattacharya and Sen (2003) argue that identification matters.", "Bhattacharya 與 Sen（2003）主張認同很重要。", zh).startsWith("Bhattacharya"));
  const cut = stripEcho("Motive uncertainty", "Motive uncertainty 動機不確定性");
  check("reports how much was cut", cut.cut === "Motive uncertainty ".length && cut.t === "動機不確定性", cut);
  check("flags an untranslated echo", isUntranslatedEcho(src, src, zh) && !isUntranslatedEcho("H1", "H1", zh) && !isUntranslatedEcho(src, "此外", zh));
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
  // table page: every cell is its own unit, read row by row after the caption
  const idx = (pre: string) => m.order.findIndex((id) => m.sentences[id].text.startsWith(pre));
  check("table: header cell is its own unit", texts.includes("Insights from the Literature"), texts.filter((t) => t.includes("Insights")));
  check("table: title not merged with headers", texts.includes("Implementation Issues and Related Guidelines"));
  check("table: spanning subheader is its own unit", texts.includes("Implementation Issues: In Both B2B and B2C Contexts"));
  check("table: cell text starts its own sentence", idx("Customers may attribute a supplier") >= 0, texts.find((t) => t.includes("Customers may attribute")));
  check("table: bullet item is its own sentence", idx("•When American Express calls") >= 0, texts.find((t) => t.includes("American Express")));
  check("table: row label spans two lines", texts.includes("Contact frequency and timing"), texts.filter((t) => t.includes("Contact frequency")));
  check("table: cells follow the caption", idx("TABLE 1") >= 0 && idx("Motive uncertainty") > idx("TABLE 1") && idx("Contact frequency") > idx("Customers may attribute"));
  const size = JSON.stringify(m).length;
  const firstSid = m.order[0];
  check("sentence ids are page.n", /^\d+\.\d+$/.test(firstSid), firstSid);
  boxesTest("two-column fixture", m);
  console.log(`  model: ${all.length} sentences, ${(size / 1024).toFixed(0)} KB`);
}

// Regression checks for real papers (local only; PDFs are gitignored).
const REAL: Record<string, (m: DocModel) => void> = {
  "pps.pdf": (m) => {
    check("pps: printed page offset 70", m.info.pageOffset === 70, m.info.pageOffset);
    const all = m.order.map((id) => m.sentences[id].text);
    check("pps: footnote not merged into body sentence", all.some((t) => t.startsWith("Thus, a key question of interest to managers")));
    check("pps: author bio is its own sentence", all.some((t) => t.startsWith("Goutam Challagalla is Brady Family Professor")));
    // Checked by hand against the printed page 70.
    const at = (prefix: string) => {
      const id = m.order.find((i) => m.sentences[i].text.startsWith(prefix));
      const p = id ? lineOf(m, id) : null;
      return p ? `${p.col}${p.line}` : "none";
    };
    check("pps: 'Thus, a key question' is left column line 22", at("Thus, a key question of interest") === "L22", at("Thus, a key question of interest"));
    check("pps: 'We argue that the locus' is right column line 3", at("We argue that the locus") === "R3", at("We argue that the locus"));
    check("pps: 'For example, suppliers such as IBM' is left column line 8", at("For example, suppliers such as IBM") === "L8", at("For example, suppliers such as IBM"));
    const toc = buildOutline(m).map((o) => m.sentences[o.sid].text);
    check("pps outline: real sections", ["Research Approach", "PPS Versus RPS", "Literature Review", "Implementing PPS", "Conclusion"].every((h) => toc.includes(h)), toc);
    check("pps outline: no table rows or keywords", !toc.some((t) => /^(Job title|Function|Characteristic|Mid-Atlantic|Keywords|Supplier Level|B2B|Defining)/.test(t)), toc);
    check("pps Table 4: cell not merged with the headers", all.some((t) => t.startsWith("Customers may attribute a supplier’s initiation")), all.find((t) => t.includes("Customers may attribute")));
    check("pps Table 4: bullets are separate items", all.some((t) => t.startsWith("•When American Express")) && all.some((t) => t === "Have customer service or research and development rather than sales function contact customers"));
    check("pps Table 1: one sentence per data row", all.includes("Health care") && all.includes("Nonprofit"), all.filter((t) => t.includes("Health care")));
  },
  "cc.pdf": (m) => {
    check("cc: printed page offset 75 (JSTOR cover page)", m.info.pageOffset === 75, m.info.pageOffset);
    const all = m.order.map((id) => m.sentences[id].text);
    check("cc: running headers skipped", !all.some((t) => /Journal of Marketing, April 2003/.test(t) && t.length < 60));
    check("cc: JSTOR boilerplate skipped", !all.some((t) => /collaborating with JSTOR|Accessibility support/.test(t)));
  },
  "sonnentag.pdf": (m) => {
    check("sonnentag: printed page offset 518", m.info.pageOffset === 518, m.info.pageOffset);
    const toc = buildOutline(m).map((o) => m.sentences[o.sid].text);
    check("sonnentag outline: starts at the first section, no author block", toc[0] === "Recovery Concept" && !toc.some((t) => /Sonnentag|Braunschweig/.test(t)), toc.slice(0, 3));
    check("sonnentag outline: has Discussion and References", toc.includes("Discussion") && toc.includes("References"), toc);
  },
};

/** Line numbers never go backwards inside one column of one page, and two-column pages report both columns. */
function linesTest(name: string, m: DocModel) {
  let back = 0;
  const cols = new Set<string>();
  let prev: { b: string; page: number; col: string | null; line: number } | null = null;
  for (const id of m.order) {
    const s = m.sentences[id];
    if (s.kind !== "para") continue;
    const pos = lineOf(m, id);
    if (!pos) continue;
    cols.add(String(pos.col));
    // Within one paragraph block on one page, sentence starts only move down the column
    // (a sentence starting at the bottom of the previous column or page belongs to the next block).
    if (prev && prev.b === s.b && prev.page === pos.page && prev.col === pos.col && pos.line < prev.line) back++;
    prev = { b: s.b, page: pos.page, col: pos.col, line: pos.line };
  }
  check(`${name}: line numbers increase within each paragraph`, back === 0, back);
  check(`${name}: left and right columns detected`, cols.has("L") && cols.has("R"), [...cols]);
}

/** Translated boxes never overlap on any page (an overlapping box hides its neighbour's text). */
function boxesTest(name: string, m: DocModel) {
  let bad = 0;
  let raw = 0;
  const where: string[] = [];
  for (const pg of m.pages) {
    const blocks = pg.blocks.filter((b) => b.kind !== "skip");
    const boxes = layoutBoxes(blocks, undefined, pg.w, pg.h);
    const left = overlappingBoxes(boxes);
    raw += overlappingBoxes(new Map(blocks.map((b) => [b.id, b.r]))).length;
    if (left.length) {
      bad += left.length;
      where.push(`p${pg.i + 1}: ${left.slice(0, 2).map((x) => x.join("×")).join(", ")}`);
    }
  }
  check(`${name}: translated boxes never overlap on any page (${raw} raw overlaps resolved)`, bad === 0, where.slice(0, 4));
}

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
    boxesTest(f, m);
    if (f !== "zh-note.pdf") linesTest(f, m);
    const kinds: Record<string, number> = {};
    for (const id of m.order) kinds[m.sentences[id].kind] = (kinds[m.sentences[id].kind] ?? 0) + 1;
    console.log(`  ${f}: ${m.pages.length} pages, ${m.order.length} sentences ${JSON.stringify(kinds)} in ${Date.now() - t0} ms`);
    if (process.env.DUMP) for (const id of m.order.slice(0, Number(process.env.DUMP))) console.log(`    [${id}|${m.sentences[id].kind}] ${m.sentences[id].text.slice(0, 110)}`);
  }
}

async function main() {
  sentencesTest();
  cleanTest();
  await fixtureTest();
  await extraFixtures();
  if (failures) {
    console.log(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nall engine tests passed");
}
main();
