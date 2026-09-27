// Generates a synthetic two-column journal article that exercises the layout
// engine: running headers with page numbers, centred and italic headings,
// hyphenation, a figure with labels + caption, and paragraphs that continue
// across columns and pages.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { writeFileSync, mkdirSync } from "node:fs";

const W = 612;
const H = 792;
const MARGIN = 54;
const GUTTER = 22;
const COL_W = (W - 2 * MARGIN - GUTTER) / 2;
const BODY = 10;
const LEAD = 12;

type Para =
  | { kind: "p"; text: string; indent?: boolean }
  | { kind: "h"; text: string }
  | { kind: "hi"; text: string }
  | { kind: "figure" };

const P1 = `Life outside work has an impact on how one feels and behaves at work. Well-being and performance at work benefit from positive mood experienced at home (Williams & Alliger, 1994) and from the absence of conflicts between family and work (Frone, 2000; Kossek & Ozeki, 1999). Moreover, researchers suggested that periods of rest from work are of particular importance for maintaining well-being at work (Eden, 2001; Quick & Quick, 1984). There is increas-{BR}ing empirical evidence that vacations and other periods of rest result in a decrease in perceived job stress and burnout (Etzion, Eden, & Lapidot, 1998).`;
const P2 = `However, vacation effects fade out quickly, and well-being deteriorates soon after a person returns to work (Westman & Eden, 1997). This observation suggests that individuals may need additional opportunities for recovery. For example, recovery that occurs in the evening after normal working days or during weekends might be very important for maintaining well-being and performance. In this article, I examine the effects of recovery in the evening after daily work in a regular work week. Specifically, the study investigates the impact of these recovery periods on subsequent work engagement and proactive behavior at work (c.f. Edwards & Rothbard, 2000). Figure 1 presents the main concepts and the hypothesized relationships to be tested in this study.`;
const P3 = `Recovery attained during leisure time has an effect on how individuals experience the subsequent work day, and it is crucial for work engagement (see Figure 1). Drawing on earlier work by Kahn (1992; cf. also Kahn, 1990), Schaufeli and his colleagues defined work engagement as a "persistent, positive affective-motivational state of fulfillment" (Maslach, Schaufeli, & Leiter, 2001, p. 417).`;
const P4 = `Work engagement is a concept relevant for employee well-being and work behavior for several reasons. First, it is a positive experience in itself (Schaufeli et al., 2002). Second, it is related to good health and positive work affect (Demerouti, Bakker, de Jonge, Janssen, & Schaufeli, 2001). Third, work engagement helps individuals derive benefits from stressful work (Britt, Adler, & Bartone, 2001). Fourth, work engagement is positively related to organizational commitment and is expected to affect employee performance (Kahn, 1990). A total of 147 employees completed a questionnaire and a daily survey over a period of 5 consecutive work days. Multilevel analyses showed that day-level recovery was positively related to day-level work engagement and day-level proactive behavior during the subsequent work day. Past research conceptualized work engagement as a relatively stable individual difference variable that shows substantial variation between persons and remains stable over time, which implies that researchers have so far neglected the possibility that engagement fluctuates within persons from one day to the next and that such fluctuations are meaningful for understanding behavior at work.`;

function body(): Para[] {
  const out: Para[] = [
    { kind: "p", text: P1 },
    { kind: "p", text: P2, indent: true },
    { kind: "h", text: "Effects of Recovery" },
    { kind: "hi", text: "Work Engagement" },
    { kind: "p", text: P3, indent: true },
    { kind: "p", text: P4, indent: true },
    { kind: "h", text: "Recovery Concept" },
  ];
  for (let i = 0; i < 7; i++) out.push({ kind: "p", text: P2.replace("However", i % 2 ? "Moreover" : "Still"), indent: true });
  out.push({ kind: "p", text: P4, indent: true });
  return out;
}

function wrap(text: string, font: PDFFont, size: number, width: number, firstIndent: number): string[] {
  const lines: string[] = [];
  const forced = text.split("{BR}");
  let indent = firstIndent;
  for (let f = 0; f < forced.length; f++) {
    const words = forced[f].split(/\s+/).filter(Boolean);
    let cur = "";
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(cand, size) > width - indent && cur) {
        lines.push(cur);
        cur = w;
        indent = 0;
      } else cur = cand;
    }
    if (cur) lines.push(cur);
    indent = 0;
  }
  return lines;
}

export async function makeFixture(path: string) {
  const doc = await PDFDocument.create();
  doc.setTitle("Recovery, Work Engagement, and Proactive Behavior");
  doc.setSubject("doi:10.1037/0021-9010.88.3.518");
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const pages: PDFPage[] = [];
  const newPage = (n: number) => {
    const pg = doc.addPage([W, H]);
    pages.push(pg);
    const label = String(517 + n);
    if (n === 1) {
      pg.drawText("Journal of Applied Psychology 2003, Vol. 88, No. 3, 518-528", { x: MARGIN, y: H - 36, size: 8, font: times });
    } else {
      const w = times.widthOfTextAtSize(label, 9);
      pg.drawText(n % 2 ? label : "SONNENTAG", { x: n % 2 ? W - MARGIN - w : MARGIN, y: H - 40, size: 9, font: times });
      pg.drawText(n % 2 ? "RECOVERY AND WORK ENGAGEMENT" : label, { x: n % 2 ? MARGIN : W - MARGIN - w, y: H - 40, size: 9, font: times });
    }
    pg.drawText("This content downloaded from 140.112.1.1 on Tue, 22 Sep 2026 04:10:07 UTC", { x: 180, y: 30, size: 7, font: times });
    pg.drawText("All use subject to https://about.jstor.org/terms", { x: 220, y: 21, size: 7, font: times });
    return pg;
  };

  // ---- page 1: title block
  let pg = newPage(1);
  const center = (t: string, y: number, size: number, font = times) => {
    pg.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2, y, size, font });
  };
  center("Recovery, Work Engagement, and Proactive Behavior:", H - 90, 16);
  center("A New Look at the Interface Between Nonwork and Work", H - 110, 16);
  center("Sabine Sonnentag", H - 140, 12);
  center("Technical University of Braunschweig", H - 154, 10);
  const abs =
    "This study examined work-related outcomes of recovery during leisure time. A total of 147 employees completed a questionnaire and a daily survey over a period of 5 consecutive work days. Multilevel analyses showed that day-level recovery was positively related to day-level work engagement and day-level proactive behavior (personal initiative, pursuit of learning) during the subsequent work day. The data suggest considerable daily fluctuations in behavior and attitudes at work.";
  let y = H - 185;
  for (const line of wrap(abs, times, 9.5, W - 2 * MARGIN - 80, 0)) {
    pg.drawText(line, { x: MARGIN + 40, y, size: 9.5, font: times });
    y -= 11.5;
  }

  // ---- columns
  let col = 0;
  let pageNo = 1;
  let top = y - 24;
  let cy = top;
  const bottom = 60;
  const nextColumn = () => {
    if (col === 0) {
      col = 1;
      cy = top;
    } else {
      pageNo++;
      pg = newPage(pageNo);
      col = 0;
      top = H - 70;
      if (pageNo === 2) {
        drawFigure(pg, times);
        top = H - 330;
      }
      cy = top;
    }
  };
  const colX = () => MARGIN + col * (COL_W + GUTTER);
  for (const para of body()) {
    if (para.kind === "p") {
      const lines = wrap(para.text, times, BODY, COL_W, para.indent ? 10 : 0);
      lines.forEach((line, i) => {
        if (cy < bottom) nextColumn();
        pg.drawText(line, { x: colX() + (i === 0 && para.indent ? 10 : 0), y: cy, size: BODY, font: times });
        cy -= LEAD;
      });
    } else if (para.kind === "h" || para.kind === "hi") {
      if (cy < bottom + 40) nextColumn();
      cy -= 8;
      const font = para.kind === "hi" ? italic : times;
      const size = para.kind === "h" ? 11 : 10;
      const w = font.widthOfTextAtSize(para.text, size);
      pg.drawText(para.text, { x: colX() + (COL_W - w) / 2, y: cy, size, font });
      cy -= LEAD + 6;
    }
  }
  // ---- last page: a three-column table set in a smaller sans font (like JM's Table 4)
  pg = newPage(pageNo + 1);
  await drawTable(doc, pg);
  const bytes = await doc.save();
  mkdirSync(path.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(path, bytes);
}

function drawFigure(pg: PDFPage, font: PDFFont) {
  const boxes: [string, number][] = [
    ["Day-Level Recovery", 150],
    ["Day-Level Work Engagement", 300],
    ["Day-Level Personal Initiative", 460],
  ];
  const y = H - 160;
  for (const [label, cx] of boxes) {
    const w = font.widthOfTextAtSize(label, 9) + 16;
    pg.drawRectangle({ x: cx - w / 2, y: y - 8, width: w, height: 26, borderColor: rgb(0, 0, 0), borderWidth: 0.8 });
    pg.drawText(label, { x: cx - w / 2 + 8, y, size: 9, font });
  }
  pg.drawText("Control Variables", { x: MARGIN, y: H - 90, size: 9, font });
  pg.drawText("Gender", { x: MARGIN + 10, y: H - 104, size: 9, font });
  const cap =
    "Figure 1. Overview of the study variables. Solid lines denote hypothesized effects. Dotted lines denote effects of control variables.";
  let yy = H - 240;
  for (const line of wrap(cap, font, 9, W - 2 * MARGIN, 0)) {
    pg.drawText(line, { x: MARGIN, y: yy, size: 9, font });
    yy -= 11;
  }
}

async function drawTable(doc: PDFDocument, pg: PDFPage) {
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const center = (t: string, y: number, size: number, font: PDFFont) => pg.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2, y, size, font });
  let y = H - 90;
  center("TABLE 1", y, 10, bold);
  y -= 12;
  center("Implementation Issues and Related Guidelines", y, 10, bold);
  y -= 18;
  const cols = [MARGIN, 150, 357];
  const widths = [85, 190, 200];
  ["Potential Issue", "Insights from the Literature", "Related Guidelines and Examples"].forEach((t, i) => pg.drawText(t, { x: cols[i] + (i ? 30 : 0), y, size: 9, font: bold }));
  y -= 16;
  center("Implementation Issues: In Both B2B and B2C Contexts", y, 9, bold);
  y -= 16;
  const cell = (text: string, col: number, top: number, hang = 0) => {
    const lines = wrap(text, reg, 9, widths[col] - hang, 0);
    lines.forEach((l, i) => pg.drawText(l, { x: cols[col] + (i ? hang : 0), y: top - i * 10, size: 9, font: reg }));
    return top - lines.length * 10;
  };
  const rows: [string, string, string[]][] = [
    [
      "Motive uncertainty",
      "Customers may attribute a supplier's initiation of contact to the supplier's short-sighted self-interest or to altruism (see DeCarlo 2005).",
      ["Train customer-facing employees to provide proactive service, not proactive selling", "•When American Express calls to alert customers on specific transactions, it makes it a point to avoid cross-selling."],
    ],
    [
      "Contact frequency and timing",
      "High contact frequency can infringe on customers' time and convenience; in turn, this can lead to annoyance (see Folger and Konovsky 1989).",
      ["Do not contact all customers with the same frequency", "•Amazon.com customers can select the types of issues for which they would like to be contacted."],
    ],
  ];
  for (const [issue, insight, guides] of rows) {
    const a = cell(issue, 0, y);
    const b = cell(insight, 1, y);
    let c = y;
    guides.forEach((g, i) => (c = cell(g, 2, c, i ? 9 : 0)));
    y = Math.min(a, b, c) - 14;
  }
}

if (process.argv[1]?.endsWith("make-fixture.ts")) {
  makeFixture("tests/fixtures/two-column.pdf").then(() => console.log("fixture written"));
}
