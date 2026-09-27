"use client";
// The child note Paper Sunshine writes back to Zotero: the one-page summary and
// your highlights (English, translation, category, page and line, comments).
import { lineLabel, lineOf } from "@/engine/lines";
import { printedPage } from "./citation";
import { db } from "./db";
import { getSettings } from "./settings";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function noteHtml(paperId: string): Promise<string> {
  const [paper, rec, one, hls, trans, settings] = await Promise.all([
    db.papers.get(paperId),
    db.models.get(paperId),
    db.onepagers.get(paperId),
    db.highlights.where("paperId").equals(paperId).filter((h) => !h.deleted).toArray(),
    db.translations.where("paperId").equals(paperId).toArray(),
    getSettings(),
  ]);
  if (!paper || !rec) throw new Error("論文尚未解析");
  const model = rec.model;
  const zh = new Map(trans.map((t) => [t.sid, t.t]));
  const where = (sid: string) => {
    const pos = lineOf(model, sid);
    if (!pos) return "";
    return `p. ${printedPage(paper, model, pos.page) ?? pos.page + 1} ${lineLabel(pos)}`;
  };
  const parts: string[] = [`<h1>Paper Sunshine 閱讀筆記</h1>`];

  if (one?.md) {
    const { citePlain } = await import("@/components/reader/OnePager");
    const md = citePlain(one.md, paper, model);
    const [{ renderToStaticMarkup }, { default: ReactMarkdown }, { default: remarkGfm }, { createElement }] = await Promise.all([
      import("react-dom/server"),
      import("react-markdown"),
      import("remark-gfm"),
      import("react"),
    ]);
    parts.push(`<h2>一頁速覽</h2>`, renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, md)));
  }

  const mine = hls.filter((h) => h.style === "highlight" || h.note);
  if (mine.length) {
    const order = new Map(model.order.map((s, i) => [s, i]));
    mine.sort((a, b) => (order.get(a.ranges[0]?.sid) ?? 0) - (order.get(b.ranges[0]?.sid) ?? 0));
    const cat = new Map(settings.categories.map((c) => [c.key, c.label]));
    parts.push(`<h2>我的劃線</h2><ul>`);
    for (const h of mine) {
      const sids = [...new Set(h.ranges.map((r) => r.sid))];
      const en = h.side === "src" ? h.text : sids.map((s) => model.sentences[s]?.text ?? "").join(" ");
      const tr = h.side === "tgt" ? h.text : sids.map((s) => zh.get(s) ?? "").join("");
      parts.push(
        `<li>${h.c ? `<b>［${esc(cat.get(h.c) ?? h.c)}］</b> ` : ""}“${esc(en)}” <i>(${esc(where(sids[0]))})</i>` +
          (tr ? `<br/>${esc(tr)}` : "") +
          (h.note ? `<br/><b>評論：</b>${esc(h.note)}` : "") +
          `</li>`,
      );
    }
    parts.push(`</ul>`);
  }
  parts.push(`<p><i>由 Paper Sunshine 於 ${new Date().toLocaleString("zh-TW")} 更新</i></p>`);
  return parts.join("\n");
}
