import { charBoundaries } from "./charwidth";
import { splitSentences } from "./sentences";
import type { Block, BlockKind, DocModel, PageInfo, Piece, RawItem, Rect, Sentence } from "./types";

export interface RawPage {
  w: number;
  h: number;
  items: RawItem[];
}

/** One character of a text stream, remembering where it came from. */
interface Ch {
  c: string;
  p: number; // page
  item: number; // item index on page, -1 for virtual characters
  k: number; // char index inside item.str
  b: number; // global block index
}

interface Line {
  items: number[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  base: number;
  fs: number;
  font: string;
  chars: Ch[];
  text: string;
}

interface WBlock {
  p: number;
  lines: Line[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  fs: number;
  font: string;
  pitch: number;
  kind: BlockKind;
  chars: Ch[];
  text: string;
  centered: boolean;
  gi: number; // global index in document order
  localId: string;
}

const TERMINAL = /[.?!。？！]["”’)\]]?$/;
const TERMINAL_OR_COLON = /[.?!:。？！：]["”’)\]]?$/;
const CAPTION_RE = /^(fig\.?|figure|table|tab\.|exhibit|chart|appendix|panel)\s*[\dA-Z]/i;
const BOILERPLATE =
  /(This content downloaded from|All use subject to|about\.jstor\.org\/terms|JSTOR is a not-for-profit|Your use of the JSTOR archive|Downloaded from|For personal use only|Copyright ©|All rights reserved|Terms of Use)/i;
const LETTER = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ぀-ヿ一-鿿가-힯]/g;

function mode(values: [number, number][]): number {
  // values: [value, weight]
  const m = new Map<number, number>();
  for (const [v, w] of values) m.set(v, (m.get(v) ?? 0) + w);
  let best = 0;
  let bw = -1;
  for (const [v, w] of m) if (w > bw) (best = v), (bw = w);
  return best;
}

function modeStr(values: [string, number][]): string {
  const m = new Map<string, number>();
  for (const [v, w] of values) m.set(v, (m.get(v) ?? 0) + w);
  let best = "";
  let bw = -1;
  for (const [v, w] of m) if (w > bw) (best = v), (bw = w);
  return best;
}

const round05 = (x: number) => Math.round(x * 2) / 2;
const isCjk = (c: string) => /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(c);

// ---------------------------------------------------------------- lines ----

function buildLines(page: RawPage, pageIndex: number): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  const items = page.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.str || !it.str.trim()) continue;
    if (cur && sameLine(cur, it, items)) {
      appendItem(cur, it, i, pageIndex);
    } else {
      cur = {
        items: [],
        x0: it.x,
        y0: it.y,
        x1: it.x + it.w,
        y1: it.y + it.h,
        base: it.base,
        fs: it.fs,
        font: it.font,
        chars: [],
        text: "",
      };
      appendItem(cur, it, i, pageIndex);
      lines.push(cur);
    }
  }
  for (const l of lines) {
    // trim trailing/leading spaces
    while (l.chars.length && l.chars[l.chars.length - 1].c === " ") l.chars.pop();
    while (l.chars.length && l.chars[0].c === " ") l.chars.shift();
    l.text = l.chars.map((c) => c.c).join("");
    const w: [number, number][] = l.items.map((ix) => [round05(items[ix].fs), items[ix].str.length]);
    l.fs = mode(w);
    l.font = modeStr(l.items.map((ix) => [items[ix].font, items[ix].str.length]));
    const bases: [number, number][] = l.items.map((ix) => [Math.round(items[ix].base), items[ix].str.length]);
    l.base = mode(bases);
  }
  return lines.filter((l) => l.text.length > 0);
}

function sameLine(line: Line, it: RawItem, items: RawItem[]): boolean {
  const last = items[line.items[line.items.length - 1]];
  const top = Math.max(line.y0, it.y);
  const bottom = Math.min(line.y1, it.y + it.h);
  const overlap = bottom - top;
  const minH = Math.min(line.y1 - line.y0, it.h);
  if (overlap < 0.45 * minH) return false;
  const fs = Math.max(last.fs, it.fs);
  const gap = it.x - (last.x + last.w);
  if (gap < -0.6 * fs) return false;
  if (gap > 1.4 * fs) return false;
  return true;
}

function appendItem(line: Line, it: RawItem, index: number, p: number) {
  const chars = line.chars;
  if (line.items.length > 0) {
    const prevIt = line.items[line.items.length - 1];
    void prevIt;
    const gap = it.x - line.x1;
    const lastC = chars[chars.length - 1]?.c;
    const cjkJoin = lastC !== undefined && isCjk(lastC) && isCjk(it.str[0]) && gap < 0.8 * it.fs;
    if (gap > 0.15 * it.fs && lastC !== " " && lastC !== undefined && !/^\s/.test(it.str) && !cjkJoin) {
      chars.push({ c: " ", p, item: -1, k: -1, b: -1 });
    }
  }
  const s = it.str;
  for (let k = 0; k < s.length; k++) {
    let c = s[k];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") c = " ";
    if (c === " " && (chars.length === 0 || chars[chars.length - 1].c === " ")) continue;
    chars.push({ c, p, item: index, k, b: -1 });
  }
  line.items.push(index);
  line.x0 = Math.min(line.x0, it.x);
  line.x1 = Math.max(line.x1, it.x + it.w);
  line.y0 = Math.min(line.y0, it.y);
  line.y1 = Math.max(line.y1, it.y + it.h);
}

// --------------------------------------------------------------- blocks ----

function newBlock(line: Line, p: number): WBlock {
  return {
    p,
    lines: [line],
    x0: line.x0,
    y0: line.y0,
    x1: line.x1,
    y1: line.y1,
    fs: line.fs,
    font: line.font,
    pitch: line.fs * 1.2,
    kind: "para",
    chars: [],
    text: "",
    centered: false,
    gi: -1,
    localId: "",
  };
}

function addLine(b: WBlock, line: Line) {
  const last = b.lines[b.lines.length - 1];
  const pitch = line.base - last.base;
  const n = b.lines.length;
  b.pitch = n === 1 ? pitch : (b.pitch * (n - 1) + pitch) / n;
  b.lines.push(line);
  b.x0 = Math.min(b.x0, line.x0);
  b.x1 = Math.max(b.x1, line.x1);
  b.y0 = Math.min(b.y0, line.y0);
  b.y1 = Math.max(b.y1, line.y1);
}

function isBreak(b: WBlock, line: Line): boolean {
  const last = b.lines[b.lines.length - 1];
  const fs = b.fs;
  const lastText = last.text.trimEnd();
  const endsTerminal = TERMINAL_OR_COLON.test(lastText);
  const n = b.lines.length;
  const bodyLeft = n >= 2 ? Math.min(...b.lines.slice(1).map((l) => l.x0)) : b.lines[0].x0;
  const indent = line.x0 - bodyLeft;
  const hanging = n >= 2 && b.lines[1].x0 > b.lines[0].x0 + 0.8 * fs;
  if (hanging) {
    if (endsTerminal && line.x0 < last.x0 - 0.8 * fs) return true;
  } else if (endsTerminal && indent > 0.8 * fs) {
    return true;
  }
  if (endsTerminal && last.x1 < b.x1 - 2.5 * fs && n >= 2) return true;
  if (n === 1) {
    const lastW = last.x1 - last.x0;
    const lineW = line.x1 - line.x0;
    if (!endsTerminal && lastW < 0.72 * lineW) return true; // heading above a paragraph
    if (last.font !== line.font && lastW < 0.9 * lineW) return true;
    if (last.fs > line.fs * 1.12) return true;
  }
  // A long paragraph followed by a clearly shorter, centred line is a heading.
  const lineW = line.x1 - line.x0;
  const blockW = b.x1 - b.x0;
  if (endsTerminal && lineW < 0.6 * blockW) {
    const lineC = (line.x0 + line.x1) / 2;
    const blockC = (b.x0 + b.x1) / 2;
    if (Math.abs(lineC - blockC) < 1.2 * fs && line.x0 > b.x0 + 2 * fs) return true;
  }
  return false;
}

function buildBlocks(lines: Line[], p: number): WBlock[] {
  const blocks: WBlock[] = [];
  for (const line of lines) {
    let best: WBlock | null = null;
    let bestPitch = Infinity;
    const start = Math.max(0, blocks.length - 16);
    for (let i = start; i < blocks.length; i++) {
      const b = blocks[i];
      const last = b.lines[b.lines.length - 1];
      if (Math.abs(line.fs - b.fs) > 0.2 * b.fs) continue;
      const pitch = line.base - last.base;
      if (pitch < 0.5 * b.fs) continue;
      const maxPitch = b.lines.length >= 2 ? Math.max(b.pitch * 1.35, b.fs * 1.1) : b.fs * 2.3;
      if (pitch > maxPitch) continue;
      const ov = Math.min(line.x1, b.x1) - Math.max(line.x0, b.x0);
      if (ov < 0.25 * Math.min(line.x1 - line.x0, b.x1 - b.x0)) continue;
      if (line.x0 < b.x0 - 3 * b.fs) continue;
      if (pitch < bestPitch) {
        best = b;
        bestPitch = pitch;
      }
    }
    if (best && !isBreak(best, line)) addLine(best, line);
    else blocks.push(newBlock(line, p));
  }
  for (const b of blocks) {
    b.fs = mode(b.lines.map((l) => [l.fs, l.text.length]));
    b.font = modeStr(b.lines.map((l) => [l.font, l.text.length]));
    joinLines(b);
  }
  return blocks;
}

/** Joins the lines of a block into one char stream, removing line-end hyphens. */
function joinLines(b: WBlock) {
  const out: Ch[] = [];
  for (const line of b.lines) {
    if (out.length) joinStreams(out, line.chars, line.chars[0]?.p ?? b.p);
    else out.push(...line.chars);
  }
  b.chars = out;
  b.text = out.map((c) => c.c).join("");
}

function joinStreams(out: Ch[], next: Ch[], p: number) {
  while (out.length && out[out.length - 1].c === " ") out.pop();
  const lastIdx = out.length - 1;
  const last = out[lastIdx];
  const beforeLast = out[lastIdx - 1];
  const first = next.find((c) => c.c !== " ");
  if (
    last &&
    (last.c === "-" || last.c === "­") &&
    beforeLast &&
    /[A-Za-z]/.test(beforeLast.c) &&
    first &&
    /[a-z]/.test(first.c)
  ) {
    out.pop(); // de-hyphenate "in-\ncreased"
  } else if (last && !(isCjk(last.c) || (first && isCjk(first.c)))) {
    out.push({ c: " ", p, item: -1, k: -1, b: -1 });
  }
  let i = 0;
  while (i < next.length && next[i].c === " ") i++;
  for (; i < next.length; i++) out.push(next[i]);
}

// ----------------------------------------------------------- classify ----

interface Ctx {
  bodyFs: number;
  bodyFont: string;
}

function classify(b: WBlock, page: RawPage, ctx: Ctx): BlockKind {
  const text = b.text.trim();
  const compact = text.replace(/\s/g, "");
  const letters = (text.match(LETTER) ?? []).length;
  if (letters < 2 || letters < 0.4 * compact.length) return "skip";
  const inMargin = b.y1 < 0.085 * page.h || b.y0 > 0.925 * page.h;
  if (inMargin && text.length < 160 && b.lines.length <= 2) return "skip";
  if (BOILERPLATE.test(text) && text.length < 400) return "skip";
  if (CAPTION_RE.test(text)) return "caption";
  const words = wordCount(text);
  const terminal = TERMINAL.test(text);
  const big = b.fs >= ctx.bodyFs * 1.12;
  const fontDiff = b.font !== ctx.bodyFont;
  // centred relative to the column the block lives in
  const W = page.w;
  const cx = (b.x0 + b.x1) / 2;
  const colLeft = b.x1 - b.x0 > 0.55 * W ? 0 : cx < W / 2 ? 0 : W / 2;
  const colRight = b.x1 - b.x0 > 0.55 * W ? W : cx < W / 2 ? W / 2 : W;
  const colC = (colLeft + colRight) / 2;
  b.centered = Math.abs(cx - colC) < 0.04 * W && b.x1 - b.x0 < 0.7 * (colRight - colLeft);
  if (b.lines.length <= 3 && words <= 25 && !terminal) {
    if (big || fontDiff || b.centered) return "heading";
    if (b.lines.length === 1 && words <= 12 && b.x1 - b.x0 < 0.6 * (colRight - colLeft)) {
      return b.fs < ctx.bodyFs * 0.95 ? "label" : "heading";
    }
  }
  if (b.fs < ctx.bodyFs * 0.92 && words < 8 && !terminal) return "label";
  if (b.lines.length <= 2 && words <= 6 && !terminal) return "label";
  return "para";
}

function wordCount(text: string): number {
  const cjk = (text.match(/[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/g) ?? []).length;
  const latin = text.replace(/[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/g, " ").split(/\s+/).filter(Boolean).length;
  return latin + cjk / 1.6;
}

// ------------------------------------------------------ reading order ----

function orderBlocks(blocks: WBlock[], W: number): WBlock[] {
  const sorted = [...blocks].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out: WBlock[] = [];
  let group: WBlock[] = [];
  const flush = () => {
    const left = group.filter((b) => (b.x0 + b.x1) / 2 < W / 2).sort((a, b) => a.y0 - b.y0);
    const right = group.filter((b) => (b.x0 + b.x1) / 2 >= W / 2).sort((a, b) => a.y0 - b.y0);
    out.push(...left, ...right);
    group = [];
  };
  for (const b of sorted) {
    const wide = b.x1 - b.x0 > 0.55 * W;
    if (wide) {
      flush();
      out.push(b);
    } else {
      group.push(b);
    }
  }
  flush();
  return out;
}

// ------------------------------------------------------------ builder ----

export function buildDocModel(pages: RawPage[], meta: { pdfTitle?: string; extraText?: string } = {}): DocModel {
  // 1. lines & blocks per page
  const pageLines = pages.map((pg, i) => buildLines(pg, i));
  const allLines = pageLines.flat();
  const bodyFs = mode(allLines.map((l) => [l.fs, l.text.length])) || 10;
  const bodyFont = modeStr(allLines.map((l) => [l.font, l.text.length]));
  const ctx: Ctx = { bodyFs, bodyFont };

  const pageBlocks: WBlock[][] = pageLines.map((lines, i) => {
    const blocks = buildBlocks(lines, i);
    for (const b of blocks) b.kind = classify(b, pages[i], ctx);
    return orderBlocks(blocks, pages[i].w);
  });

  const docBlocks: WBlock[] = [];
  pageBlocks.forEach((blocks, p) => {
    blocks.forEach((b, n) => {
      b.gi = docBlocks.length;
      b.localId = `${p}-${n}`;
      for (const c of b.chars) c.b = b.gi;
      docBlocks.push(b);
    });
  });

  // 2. flows: paragraphs that continue across columns and pages
  const flows: WBlock[][] = [];
  // Open (unfinished) paragraphs keyed by font size. A heading in between
  // normally ends them, unless the next block clearly continues the sentence
  // (starts in lower case), e.g. across a figure placed at the top of a page.
  const openPara = new Map<number, { flow: WBlock[]; block: WBlock; headingAfter: boolean }>();
  for (const b of docBlocks) {
    if (b.kind === "skip") continue;
    if (b.kind === "para") {
      const startsLower = /^[a-z(\[]/.test(b.text.trim());
      let target: WBlock[] | null = null;
      for (const [fsKey, entry] of openPara) {
        if (Math.abs(fsKey - b.fs) > 0.12 * b.fs) continue;
        if (TERMINAL_OR_COLON.test(entry.block.text.trim())) continue;
        if (entry.headingAfter && !startsLower) continue;
        const eb = entry.block;
        const pw = pages[eb.p].w;
        const colW = eb.x1 - eb.x0 > 0.55 * pw ? pw : pw / 2;
        if (eb.lines.length === 1 && eb.x1 - eb.x0 < 0.55 * colW && !startsLower) continue; // short title-like line
        target = entry.flow;
        break;
      }
      if (target) target.push(b);
      else flows.push((target = [b]));
      for (const k of [...openPara.keys()]) if (Math.abs(k - b.fs) <= 0.12 * b.fs) openPara.delete(k);
      openPara.set(b.fs, { flow: target, block: b, headingAfter: false });
    } else if (b.kind === "heading") {
      flows.push([b]);
      for (const e of openPara.values()) e.headingAfter = true;
    } else {
      flows.push([b]);
    }
  }

  // 3. sentences
  interface Tmp {
    text: string;
    chars: Ch[];
    kind: BlockKind;
    homeGi: number;
    firstPos: number;
  }
  const tmp: Tmp[] = [];
  for (const flow of flows) {
    const chars: Ch[] = [];
    for (const b of flow) {
      if (!chars.length) chars.push(...b.chars);
      else joinStreams(chars, b.chars, b.p);
    }
    while (chars.length && chars[chars.length - 1].c === " ") chars.pop();
    const text = chars.map((c) => c.c).join("");
    const kind = flow[0].kind;
    const ranges: [number, number][] =
      kind === "heading" || kind === "label" ? [[0, text.length]] : splitSentences(text);
    for (const [a, z] of ranges) {
      const sc = chars.slice(a, z);
      const counts = new Map<number, number>();
      for (const c of sc) if (c.b >= 0) counts.set(c.b, (counts.get(c.b) ?? 0) + 1);
      let homeGi = sc[0]?.b ?? flow[0].gi;
      let bestCount = -1;
      for (const [gi, cnt] of counts) if (cnt > bestCount) (homeGi = gi), (bestCount = cnt);
      const firstPos = docBlocks[sc[0]?.b ?? homeGi]?.gi ?? homeGi;
      tmp.push({ text: text.slice(a, z), chars: sc, kind, homeGi, firstPos: firstPos * 1e6 + a });
    }
  }
  tmp.sort((x, y) => x.homeGi - y.homeGi || x.firstPos - y.firstPos);

  const sentences: Record<string, Sentence> = {};
  const order: string[] = [];
  const perPage = new Map<number, number>();
  const blockSids = new Map<number, string[]>();
  for (const t of tmp) {
    const home = docBlocks[t.homeGi];
    const n = (perPage.get(home.p) ?? 0) + 1;
    perPage.set(home.p, n);
    const id = `${home.p + 1}.${n}`;
    sentences[id] = {
      id,
      p: home.p,
      b: home.localId,
      kind: t.kind,
      text: t.text,
      pieces: buildPieces(t.chars, pages),
    };
    order.push(id);
    const list = blockSids.get(home.gi) ?? [];
    list.push(id);
    blockSids.set(home.gi, list);
  }

  // 4. page infos
  const pageInfos: PageInfo[] = pages.map((pg, i) => ({
    i,
    w: pg.w,
    h: pg.h,
    blocks: pageBlocks[i].map(
      (b): Block => ({
        id: b.localId,
        p: i,
        r: [b.x0, b.y0, b.x1, b.y1],
        kind: b.kind,
        fs: b.fs,
        lh: b.lines.length > 1 ? b.pitch : b.fs * 1.2,
        nl: b.lines.length,
        sids: blockSids.get(b.gi) ?? [],
        text: b.kind === "skip" ? b.text.slice(0, 200) : undefined,
        centered: b.centered || undefined,
      }),
    ),
  }));

  // 5. document info
  const pageNumbers = detectPageNumbers(pageBlocks, pages);
  const pageOffset = votePageOffset(pageNumbers);
  const firstText = docBlocks
    .filter((b) => b.p < 3)
    .map((b) => b.text)
    .join("\n");
  const doi = findDoi(`${meta.extraText ?? ""}\n${firstText}`);
  const title = guessTitle(docBlocks, bodyFs);

  return {
    v: 1,
    pages: pageInfos,
    sentences,
    order,
    bodyFs,
    info: { doi, title, pdfTitle: meta.pdfTitle, pageNumbers, pageOffset },
  };
}

function buildPieces(chars: Ch[], pages: RawPage[]): Piece[] {
  const pieces: Piece[] = [];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c.item < 0) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < chars.length && chars[j].item === c.item && chars[j].p === c.p && chars[j].k === chars[j - 1].k + 1) j++;
    const it = pages[c.p].items[c.item];
    const bounds = charBoundaries(it.str, it.x, it.x + it.w);
    const k0 = c.k;
    const k1 = chars[j - 1].k + 1;
    const r: Rect = [round2(bounds[k0]), round2(it.y), round2(bounds[k1]), round2(it.y + it.h)];
    pieces.push({ s: i, e: j, p: c.p, r, fs: round2(it.fs) });
    i = j;
  }
  return pieces;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

// ------------------------------------------------------ doc info ----

function detectPageNumbers(pageBlocks: WBlock[][], pages: RawPage[]): (number | null)[] {
  return pageBlocks.map((blocks, i) => {
    const H = pages[i].h;
    const cands: number[] = [];
    for (const b of blocks) {
      if (b.y1 > 0.1 * H && b.y0 < 0.9 * H) continue;
      const t = b.text.trim();
      if (t.length > 160) continue;
      const range = t.match(/(\d{1,4})\s*[-–]\s*\d{1,4}$/);
      if (range) {
        cands.push(Number(range[1]));
        continue;
      }
      const m1 = t.match(/^(\d{1,4})\b/);
      const m2 = t.match(/\b(\d{1,4})$/);
      for (const m of [m1, m2]) {
        if (!m) continue;
        const n = Number(m[1]);
        if (n >= 1900 && n <= 2099 && t.length > 4) continue;
        if (n > 0) cands.push(n);
      }
    }
    return cands.length ? cands[0] : null;
  });
}

function votePageOffset(nums: (number | null)[]): number | null {
  const votes = new Map<number, number>();
  nums.forEach((n, i) => {
    if (n != null) votes.set(n - i, (votes.get(n - i) ?? 0) + 1);
  });
  let best: number | null = null;
  let bc = 0;
  for (const [off, c] of votes) if (c > bc) (best = off), (bc = c);
  const need = nums.length <= 2 ? 1 : 2;
  return bc >= need ? best : null;
}

export function findDoi(text: string): string | undefined {
  const m = text.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+[A-Za-z0-9])/);
  if (!m) return undefined;
  return m[1].replace(/[.;,)]+$/, "");
}

function guessTitle(blocks: WBlock[], bodyFs: number): string | undefined {
  let best: WBlock | null = null;
  for (const b of blocks) {
    if (b.p > 1 || b.kind === "skip") continue;
    const words = b.text.split(/\s+/).length;
    if (words < 3 || words > 40) continue;
    if (b.fs < bodyFs * 1.15) continue;
    if (!best || b.fs > best.fs + 0.5) best = b;
  }
  return best?.text.trim();
}
