"use client";
import type { DocModel, SentRange, Side } from "@/engine/types";
import type { Overview } from "@/lib/apiTypes";
import { type HighlightStyle, db, uid } from "@/lib/db";
import type { SelectionInfo } from "@/lib/selection";
import { locate } from "./ReaderData";

export function pageOfRange(model: DocModel, side: Side, r: SentRange): number {
  if (side === "tgt") return model.sentences[r.sid]?.p ?? 0;
  return locate(model, r.sid, r.start)?.page ?? model.sentences[r.sid]?.p ?? 0;
}

export async function createHighlight(paperId: string, model: DocModel, sel: SelectionInfo, color: string, style: HighlightStyle = "highlight", note = "") {
  const now = Date.now();
  const id = uid();
  await db.highlights.put({
    id,
    paperId,
    side: sel.side,
    ranges: sel.ranges,
    color,
    style,
    note,
    text: sel.text,
    page: pageOfRange(model, sel.side, sel.ranges[0]),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function softDelete(table: "highlights" | "explanations", id: string) {
  await db[table].update(id, { deleted: true, updatedAt: Date.now() });
}

/** Paragraph around the selected sentences (source text), for explanations. */
export function contextFor(model: DocModel, sids: string[]): string {
  const blocks = new Set(sids.map((s) => model.sentences[s]?.b));
  const out: string[] = [];
  for (const sid of model.order) if (blocks.has(model.sentences[sid].b)) out.push(model.sentences[sid].text);
  return out.join(" ").slice(0, 2500);
}

export function overviewText(o?: Overview): string {
  if (!o) return "";
  const kw = o.keywords.map((k) => `${k.en}（${k.zh}）：${k.def}`).join("\n");
  return `${o.summary3.join("\n")}\n關鍵詞：\n${kw}`;
}

export function fullText(model: DocModel, max = 150000): string {
  const parts: string[] = [];
  let len = 0;
  let page = -1;
  for (const sid of model.order) {
    const s = model.sentences[sid];
    if (s.p !== page) {
      page = s.p;
      parts.push(`\n[p.${page + 1}]`);
    }
    const t = s.kind === "heading" ? `\n## ${s.text}\n` : s.text;
    parts.push(t);
    len += t.length;
    if (len > max) break;
  }
  return parts.join(" ");
}
