// Guards against a model echoing the English sentence before (or instead of)
// its translation, e.g. "In addition, we draw on ... (see Table 4). 此外，我們…".
// Pure functions: used when translations arrive and to repair stored ones.

const HAN = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const OPEN = /^[（(【「『〔［[]/;
const TRAIL = /[\s.,;:!?'"’”)\]}。，；：！？、》」』）…]/;

/** Letters and digits only, lower case: ignores spacing, hyphens, quotes and ligatures. */
function norm(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Dice similarity of character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) ?? 0);
  return (2 * hit) / (a.length - 1 + (b.length - 1));
}

export function isCjkTarget(targetLanguage: string): boolean {
  return /中文|chinese|日本|japanese|韓|한국|korean/i.test(targetLanguage);
}

/** Index in t right after an echoed copy of src at its start, or -1. */
function echoEnd(src: string, t: string): number {
  const want = norm(src);
  if (want.length < 6) return -1;
  // Exact echo (ignoring punctuation and spacing).
  let got = "";
  for (let i = 0; i < t.length; i++) {
    got += norm(t[i]);
    if (got.length > want.length || !want.startsWith(got)) break;
    if (got === want) return i + 1;
  }
  // Near echo: everything before the first CJK character reads like the source.
  const k = t.search(HAN);
  if (k <= 0) return -1;
  const head = norm(t.slice(0, k));
  if (head.length < 0.8 * want.length || head.length > 1.25 * want.length) return -1;
  return similarity(head, want) >= 0.85 ? k : -1;
}

/**
 * Removes an echoed source sentence from the start of a translation. Returns
 * the cleaned text and how many characters were cut from the front (so ranges
 * that index into the old string can be shifted).
 */
export function stripEcho(src: string, t: string): { t: string; cut: number } {
  let end = echoEnd(src, t);
  if (end < 0) return { t, cut: 0 };
  while (end < t.length && TRAIL.test(t[end])) end++;
  const rest = t.slice(end);
  // "English term（中文）" is the glossary format, not an echo; an echo with nothing after it is left to the caller.
  if (!rest.trim() || OPEN.test(rest)) return { t, cut: 0 };
  return { t: rest, cut: end };
}

/** Cleans one translation as it arrives from the model. */
export function cleanTranslation(src: string, raw: string, targetLanguage: string): string {
  let t = raw.trim();
  // "id<TAB>English<TAB>中文": keep the last field that is in the target script.
  if (t.includes("\t")) {
    const parts = t.split("\t").map((p) => p.trim()).filter(Boolean);
    const cjk = isCjkTarget(targetLanguage);
    t = [...parts].reverse().find((p) => !cjk || HAN.test(p)) ?? parts[parts.length - 1] ?? "";
  }
  return stripEcho(src, t).t.trim();
}

/**
 * True when a "translation" into a CJK language is just the English source again
 * (the model skipped it). Short strings, numbers and names are left alone.
 */
export function isUntranslatedEcho(src: string, t: string, targetLanguage: string): boolean {
  if (!isCjkTarget(targetLanguage) || HAN.test(t)) return false;
  const words = src.match(/[A-Za-z]{2,}/g) ?? [];
  if (words.length < 4) return false;
  return similarity(norm(src), norm(t)) >= 0.8;
}
