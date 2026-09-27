// Table of contents from the layout model. The layout engine tags any short,
// bold-looking line as a heading, which also catches table rows, figure labels
// and the title block; this keeps only real section headings.
import type { DocModel } from "./types";

export interface OutlineItem {
  sid: string;
  level: 1 | 2;
  page: number;
}

const NOT_HEADING = /^(keywords?|key words|jel|note|notes|source|\*|•|\(|\d+\s*$)/i;

export function buildOutline(model: DocModel): OutlineItem[] {
  const body = model.bodyFs || 10;
  const order = model.order;
  const firstPara = order.findIndex((sid) => {
    const s = model.sentences[sid];
    return s.kind === "para" && s.text.length > 60;
  });

  // Runs of 3+ consecutive heading/label lines are tables or figure labels.
  const inRun = new Set<string>();
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j < order.length && ["heading", "label"].includes(model.sentences[order[j]].kind)) j++;
    if (j - i >= 3) for (let k = i; k < j; k++) inRun.add(order[k]);
    i = j > i ? j : i + 1;
  }

  const out: OutlineItem[] = [];
  order.forEach((sid, i) => {
    const s = model.sentences[sid];
    if (s.kind !== "heading" || inRun.has(sid)) return;
    if (i < firstPara) return; // title, authors, affiliations
    const pc = s.pieces[0];
    if (!pc) return;
    const fs = pc.fs;
    const text = s.text.trim();
    if (fs < body * 0.97) return; // table cells and figure labels are set smaller
    if (fs >= body * 1.8) return; // a repeated title
    if (text.length < 2 || NOT_HEADING.test(text)) return;
    if (!/^[\p{Lu}\p{N}\p{Script=Han}]/u.test(text)) return;
    if (/\.\s+\S/.test(text) || (text.length > 60 && fs < body * 1.15)) return; // prose, not a heading
    // A section heading is followed by text soon after.
    const soon = order.slice(i + 1, i + 9).some((x) => {
      const n = model.sentences[x];
      return (n.kind === "para" && n.text.length >= 60) || n.kind === "caption";
    });
    if (!soon) return;
    const block = model.pages[s.p].blocks.find((b) => b.id === s.b);
    const level: 1 | 2 = fs >= body * 1.25 || block?.centered || /^(references?|bibliography|參考文獻)$/i.test(text) ? 1 : 2;
    out.push({ sid, level, page: pc.p });
  });

  // Chinese numbering: 「一、」 sections contain 「1.」 subsections, whatever the layout flags say.
  const txt = (o: OutlineItem) => model.sentences[o.sid].text.trim();
  if (out.some((o) => /^[一二三四五六七八九十]+、/.test(txt(o)))) {
    for (const o of out) o.level = /^[一二三四五六七八九十]+、/.test(txt(o)) ? 1 : /^\d+[.、．]/.test(txt(o)) ? 2 : o.level;
  }
  return out;
}
