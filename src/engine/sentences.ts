// Sentence segmentation tuned for academic prose (APA citations, et al., e.g.,
// p. 417, initials) plus CJK punctuation.

const ABBREVIATIONS = new Set(
  [
    "e.g", "i.e", "al", "cf", "c.f", "vs", "etc", "fig", "figs", "eq", "eqs", "no", "nos",
    "vol", "vols", "pp", "p", "ed", "eds", "dr", "mr", "mrs", "ms", "prof", "inc", "ltd",
    "co", "corp", "jr", "sr", "st", "approx", "resp", "ph.d", "u.s", "u.k", "e.u", "viz",
    "sect", "ch", "chap", "tab", "ibid", "op", "ca", "est", "dept", "univ", "assoc", "jan",
    "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "n.d",
    "a.m", "p.m", "ref", "refs", "eqn", "suppl", "rev", "trans", "comp", "fn",
  ].map((s) => s.toLowerCase()),
);

const CLOSERS = "\"'”’)]»";
const OPENERS_OK = "\"'“‘([«";

function isUpper(c: string) {
  return c.toLowerCase() !== c && c.toUpperCase() === c;
}

function wordBefore(text: string, dotIndex: number): string {
  let i = dotIndex - 1;
  while (i >= 0 && /[A-Za-z.]/.test(text[i])) i--;
  return text.slice(i + 1, dotIndex);
}

/** Returns [start, end) ranges of trimmed sentences. */
export function splitSentences(text: string): [number, number][] {
  const cuts: number[] = [];
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (c === "。" || c === "！" || c === "？") {
      let j = i + 1;
      while (j < n && (CLOSERS.includes(text[j]) || text[j] === "」" || text[j] === "』")) j++;
      cuts.push(j);
      i = j - 1;
      continue;
    }
    if (c !== "." && c !== "?" && c !== "!") continue;
    // Skip decimal numbers and ellipses inside words.
    if (c === "." && i + 1 < n && /[0-9A-Za-z]/.test(text[i + 1])) continue;
    let j = i + 1;
    while (j < n && CLOSERS.includes(text[j])) j++;
    if (j >= n) continue; // end of text is a cut anyway
    if (!/\s/.test(text[j])) continue;
    let k = j;
    while (k < n && /\s/.test(text[k])) k++;
    if (k >= n) continue;
    const next = text[k];
    const nextOk = isUpper(next) || /[0-9]/.test(next) || OPENERS_OK.includes(next) || /[一-鿿]/.test(next);
    if (!nextOk) continue;
    if (c === ".") {
      const w = wordBefore(text, i);
      const lw = w.toLowerCase();
      if (ABBREVIATIONS.has(lw)) continue;
      if (/^[A-Z]$/.test(w)) continue; // initials: "S. Sonnentag"
      if (/^([A-Za-z]\.)+[A-Za-z]$/.test(w)) continue; // "U.S", "e.g"
    }
    cuts.push(j);
  }
  const ranges: [number, number][] = [];
  let start = 0;
  const push = (a: number, b: number) => {
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a) ranges.push([a, b]);
  };
  for (const cut of cuts) {
    push(start, cut);
    start = cut;
  }
  push(start, n);
  // Merge fragments that are too short to be sentences ("1.", "a.").
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const len = r[1] - r[0];
    const prev = merged[merged.length - 1];
    if (len < 4 && prev === undefined) {
      merged.push(r);
      continue;
    }
    if (prev && prev[1] - prev[0] < 4) {
      prev[1] = r[1];
      continue;
    }
    if (len < 4 && prev) {
      prev[1] = r[1];
      continue;
    }
    merged.push(r);
  }
  return merged;
}
