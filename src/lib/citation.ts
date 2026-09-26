// APA 7 in-text citations with printed page numbers, plus RIS / Markdown export
// (RIS imports into Zotero; highlights become notes).
import type { DocModel } from "@/engine/types";
import type { Explanation, Highlight, Paper } from "./db";
import { HIGHLIGHT_COLORS } from "./defaults";

export function printedPage(paper: Paper | undefined, model: DocModel | undefined, pageIndex: number): string | null {
  const offset = paper?.pageOffset ?? model?.info.pageOffset ?? paper?.detectedPageOffset ?? null;
  if (offset == null) return null;
  const n = pageIndex + offset;
  return n > 0 ? String(n) : null;
}

export function authorShort(paper: Paper): string {
  const a = paper.authors;
  if (!a.length) return paper.title.split(/\s+/).slice(0, 3).join(" ");
  if (a.length === 1) return a[0].family;
  if (a.length === 2) return `${a[0].family} & ${a[1].family}`;
  return `${a[0].family} et al.`;
}

export function inText(paper: Paper, page?: string | null): string {
  const year = paper.year ?? "n.d.";
  return `(${authorShort(paper)}, ${year}${page ? `, p. ${page}` : ""})`;
}

function initials(given?: string) {
  if (!given) return "";
  return given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((g) => `${g[0].toUpperCase()}.`)
    .join(" ");
}

export function apaReference(p: Paper): string {
  const names = p.authors.map((a) => (a.given ? `${a.family}, ${initials(a.given)}` : a.family));
  let authors = "";
  if (names.length === 1) authors = names[0];
  else if (names.length > 1 && names.length <= 20) authors = `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  else if (names.length > 20) authors = `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}`;
  const parts = [`${authors} (${p.year ?? "n.d."}). ${p.title}.`];
  if (p.journal) {
    let j = ` *${p.journal}*`;
    if (p.volume) j += `, *${p.volume}*`;
    if (p.issue) j += `(${p.issue})`;
    if (p.firstPage) j += `, ${p.firstPage}${p.lastPage ? `–${p.lastPage}` : ""}`;
    parts.push(`${j}.`);
  }
  if (p.doi) parts.push(` https://doi.org/${p.doi}`);
  return parts.join("");
}

export function quoteWithCitation(text: string, paper: Paper, page: string | null): string {
  return `“${text.trim()}” ${inText(paper, page)}`;
}

function risLine(tag: string, value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "";
  return `${tag}  - ${String(value).replace(/\r?\n/g, " ")}\r\n`;
}

export function toRis(
  paper: Paper,
  opts: { highlights?: Highlight[]; explanations?: Explanation[]; model?: DocModel; translations?: Map<string, string> } = {},
): string {
  let out = risLine("TY", "JOUR");
  out += risLine("TI", paper.title);
  for (const a of paper.authors) out += risLine("AU", a.given ? `${a.family}, ${a.given}` : a.family);
  out += risLine("PY", paper.year);
  out += risLine("JO", paper.journal);
  out += risLine("VL", paper.volume);
  out += risLine("IS", paper.issue);
  out += risLine("SP", paper.firstPage);
  out += risLine("EP", paper.lastPage);
  out += risLine("DO", paper.doi);
  if (paper.doi) out += risLine("UR", `https://doi.org/${paper.doi}`);
  out += risLine("AB", paper.abstract);
  for (const t of paper.tags) out += risLine("KW", t);
  const notes = highlightNotes(paper, opts);
  if (notes) out += risLine("N1", notes.replace(/\n/g, "<br>"));
  out += "ER  - \r\n";
  return out;
}

function highlightNotes(
  paper: Paper,
  opts: { highlights?: Highlight[]; explanations?: Explanation[]; model?: DocModel; translations?: Map<string, string> },
): string {
  const lines: string[] = [];
  const hs = (opts.highlights ?? []).filter((h) => !h.deleted).sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
  if (hs.length) lines.push("Paper Sunshine highlights");
  for (const h of hs) {
    const pg = printedPage(paper, opts.model, h.page);
    const color = HIGHLIGHT_COLORS.find((c) => c.key === h.color)?.label ?? h.color;
    let line = `[${color}] “${h.text}” (p. ${pg ?? h.page + 1})`;
    if (h.side === "tgt" && opts.model) {
      const en = h.ranges.map((r) => opts.model!.sentences[r.sid]?.text ?? "").join(" ");
      line += ` / EN: ${en}`;
    } else if (opts.translations) {
      const zh = h.ranges.map((r) => opts.translations!.get(r.sid) ?? "").join("");
      if (zh) line += ` / 譯：${zh}`;
    }
    if (h.note) line += `｜筆記：${h.note}`;
    lines.push(line);
  }
  return lines.join("\n");
}

export function toMarkdown(
  paper: Paper,
  opts: { highlights?: Highlight[]; explanations?: Explanation[]; model?: DocModel; translations?: Map<string, string>; notes?: string },
): string {
  const out: string[] = [`# ${paper.title}`, "", apaReference(paper), ""];
  const hs = (opts.highlights ?? []).filter((h) => !h.deleted).sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
  if (hs.length) {
    out.push("## 劃線與評論", "");
    for (const h of hs) {
      const pg = printedPage(paper, opts.model, h.page);
      out.push(`- “${h.text}” ${inText(paper, pg)}`);
      if (h.side === "src" && opts.translations) {
        const zh = h.ranges.map((r) => opts.translations!.get(r.sid) ?? "").join("");
        if (zh) out.push(`  - 譯文：${zh}`);
      }
      if (h.side === "tgt" && opts.model) {
        const en = h.ranges.map((r) => opts.model!.sentences[r.sid]?.text ?? "").join(" ");
        out.push(`  - 原文：${en}`);
      }
      if (h.note) out.push(`  - 評論：${h.note}`);
    }
    out.push("");
  }
  const ex = (opts.explanations ?? []).filter((e) => !e.deleted);
  if (ex.length) {
    out.push("## 解釋", "");
    for (const e of ex) out.push(`### ${e.query}`, "", e.answer, "");
  }
  if (opts.notes) out.push("## 筆記", "", opts.notes, "");
  return out.join("\n");
}

export function download(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFileName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, " ").slice(0, 80).trim() || "paper";
}
