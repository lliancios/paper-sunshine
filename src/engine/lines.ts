// Where a sentence sits on its page, in the terms a reader uses:
// "p. 71, left column, line 12". Lines are counted per column from the top,
// over text the engine kept (running headers and footers are not counted).
import type { DocModel } from "./types";

export type Column = "L" | "R" | null;
export interface LinePos {
  page: number; // page index
  col: Column; // null on single-column pages or full-width blocks
  line: number; // 1-based
}

interface PageLines {
  twoCol: boolean;
  // line centres (y) per column key: "L", "R" or "*" (whole page)
  lines: Record<string, number[]>;
}

const cache = new WeakMap<DocModel, Map<number, PageLines>>();

type BlockLike = { r: [number, number, number, number] };

/** A block belongs to a column only if it sits inside one half of the page (centred titles don't). */
function colOf(b: BlockLike, W: number): Column {
  if (b.r[2] <= W * 0.56) return "L";
  if (b.r[0] >= W * 0.44) return "R";
  return null;
}
function blockAt<B extends BlockLike>(blocks: B[], x: number, y: number): B | undefined {
  return blocks.find((b) => x >= b.r[0] - 1 && x <= b.r[2] + 1 && y >= b.r[1] - 1 && y <= b.r[3] + 1);
}

function pageLines(model: DocModel, p: number): PageLines {
  let byPage = cache.get(model);
  if (!byPage) cache.set(model, (byPage = new Map()));
  const hit = byPage.get(p);
  if (hit) return hit;

  const page = model.pages[p];
  const W = page.w;
  const blocks = page.blocks.filter((b) => b.kind !== "skip");
  const twoCol = blocks.some((b) => colOf(b, W) === "R") && blocks.some((b) => colOf(b, W) === "L");

  const ys: Record<string, { y: number; fs: number }[]> = { L: [], R: [], "*": [] };
  for (const sid of model.order) {
    for (const pc of model.sentences[sid].pieces) {
      if (pc.p !== p) continue;
      const y = (pc.r[1] + pc.r[3]) / 2;
      const cx = (pc.r[0] + pc.r[2]) / 2;
      ys["*"].push({ y, fs: pc.fs });
      // Column lines only count text inside column-width blocks (not a full-width abstract above).
      const b = blockAt(blocks, cx, y);
      const col = twoCol && b ? colOf(b, W) : null;
      if (col) ys[col].push({ y, fs: pc.fs });
    }
  }
  const cluster = (arr: { y: number; fs: number }[]) => {
    const sorted = [...arr].sort((a, b) => a.y - b.y);
    const out: number[] = [];
    for (const it of sorted) {
      const last = out[out.length - 1];
      if (last === undefined || it.y - last > Math.max(2, it.fs * 0.45)) out.push(it.y);
    }
    return out;
  };
  const res: PageLines = { twoCol, lines: { L: cluster(ys.L), R: cluster(ys.R), "*": cluster(ys["*"]) } };
  byPage.set(p, res);
  return res;
}

/** Page, column and line of the start of a sentence. */
export function lineOf(model: DocModel, sid: string): LinePos | null {
  const s = model.sentences[sid];
  const pc = s?.pieces[0];
  if (!s || !pc) return null;
  const page = model.pages[pc.p];
  const W = page.w;
  const info = pageLines(model, pc.p);
  const cx = (pc.r[0] + pc.r[2]) / 2;
  const y = (pc.r[1] + pc.r[3]) / 2;
  const block = blockAt(page.blocks, cx, y);
  const col: Column = info.twoCol && block ? colOf(block, W) : null;
  const lines = info.lines[col ?? "*"];
  let best = 0;
  for (let i = 0; i < lines.length; i++) if (Math.abs(lines[i] - y) < Math.abs(lines[best] - y)) best = i;
  return { page: pc.p, col, line: best + 1 };
}

/** "左欄第 12 行" style label (without the page). */
export function lineLabel(pos: LinePos, short = false): string {
  const col = pos.col === "L" ? "左欄" : pos.col === "R" ? "右欄" : "";
  return short ? `${col}${col ? " " : ""}${pos.line} 行` : `${col}第 ${pos.line} 行`;
}
