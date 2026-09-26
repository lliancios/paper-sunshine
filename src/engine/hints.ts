// Bibliographic hints read from the first pages, for papers whose PDF does
// not print a DOI (e.g. "ISSN: 0022-2429 … Vol. 73 (March 2009), 70–87").
import { findDoi } from "./layout";
import type { DocModel } from "./types";

export interface CitationHints {
  doi?: string;
  issn: string[];
  year?: number;
  volume?: string;
  firstPage?: string;
  titles: string[];
}

const JOURNALISH = /^(journal of|the journal|jstor|stable url|this content|downloaded|copyright|©|vol\.|volume|issn|american|academy of)/i;

export function citationHints(model: DocModel): CitationHints {
  const pages = model.pages.slice(0, 3);
  const lines: string[] = [];
  for (const pg of pages) {
    for (const b of pg.blocks) {
      if (b.kind === "skip") {
        if (b.text) lines.push(b.text);
      } else {
        lines.push(b.sids.map((sid) => model.sentences[sid]?.text ?? "").join(" "));
      }
    }
  }
  const all = lines.join("\n");

  const issn = [...new Set([...all.matchAll(/ISSN[:\s]*((?:\d{4})-?(?:\d{3}[\dXx]))/g)].map((m) => normIssn(m[1])))];
  // also "0022-2429 (print), 1547-7185 (electronic)"
  for (const m of all.matchAll(/\b(\d{4}-\d{3}[\dXx])\s*\((?:print|online|electronic)\)/gi)) {
    const v = normIssn(m[1]);
    if (!issn.includes(v)) issn.push(v);
  }

  let year: number | undefined;
  let volume: string | undefined;
  let firstPage: string | undefined;
  // Prefer the journal citation line: it carries volume, year and page range together.
  for (const line of lines) {
    const vol = line.match(/\bVol(?:ume)?\.?\s*(\d{1,4})\b/i);
    if (!vol) continue;
    const around = line.slice(Math.max(0, (vol.index ?? 0) - 60), (vol.index ?? 0) + 120);
    const y = around.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
    const pp = around.match(/\b(\d{1,5})\s*[–—-]\s*(\d{1,5})\b(?!\s*\))/g);
    volume = vol[1];
    if (y) year = Number(y[1]);
    if (pp) {
      for (const cand of pp) {
        const [a, b] = cand.split(/\s*[–—-]\s*/).map(Number);
        if (b > a && b - a < 250 && a !== year) {
          firstPage = String(a);
          break;
        }
      }
    }
    if (year || firstPage) break;
  }
  if (!firstPage && model.info.pageNumbers.some((n) => n != null)) {
    const first = model.info.pageNumbers.find((n) => n != null);
    if (first) firstPage = String(first);
  }

  const titles: string[] = [];
  const heads = model.pages
    .slice(0, 2)
    .flatMap((pg) => pg.blocks)
    .filter((b) => b.kind === "heading" || (b.kind === "para" && b.nl <= 3))
    .map((b) => ({ fs: b.fs, text: b.sids.map((sid) => model.sentences[sid]?.text ?? "").join(" ").trim() }))
    .filter((h) => h.text.split(/\s+/).length >= 3 && h.text.split(/\s+/).length <= 30 && !JOURNALISH.test(h.text))
    .sort((a, b) => b.fs - a.fs);
  const pdfTitle = model.info.pdfTitle && model.info.pdfTitle.split(/\s+/).length >= 4 && !/microsoft word|untitled|\.pdf$|^doi|sci-hub/i.test(model.info.pdfTitle) ? model.info.pdfTitle : undefined;
  for (const t of [pdfTitle, model.info.title, ...heads.slice(0, 3).map((h) => h.text)]) {
    if (t && !titles.includes(t) && !JOURNALISH.test(t)) titles.push(t);
  }

  return { doi: model.info.doi ?? findDoi(all), issn, year, volume, firstPage, titles: titles.slice(0, 4) };
}

function normIssn(s: string) {
  const d = s.replace(/-/g, "").toUpperCase();
  return `${d.slice(0, 4)}-${d.slice(4)}`;
}
