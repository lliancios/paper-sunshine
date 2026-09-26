// Relative glyph widths (roughly Times/Helvetica averaged). Only used to place
// characters *inside* a text item whose total width pdf.js already gives us,
// so errors never accumulate beyond one item.

const NARROW = new Set("iljtfrI.,;:'!|()[]{}/`\"-·’‘");
const WIDE = new Set("mwMW@%");
const UPPER_WIDE = new Set("ABCDGHKNOQRUVXY&");

export function charWidth(c: string): number {
  if (c === " " || c === " ") return 0.26;
  const code = c.codePointAt(0) ?? 0;
  if (code >= 0x2e80 && code <= 0x9fff) return 1; // CJK
  if (code >= 0xff00 && code <= 0xffef) return 1; // full-width forms
  if (code >= 0x3000 && code <= 0x303f) return 1; // CJK punctuation
  if (NARROW.has(c)) return 0.3;
  if (WIDE.has(c)) return 0.86;
  if (c >= "0" && c <= "9") return 0.5;
  if (c >= "A" && c <= "Z") return UPPER_WIDE.has(c) ? 0.72 : 0.62;
  return 0.48;
}

/** Cumulative boundaries (length n+1) of `text`, scaled to [x0, x1]. */
export function charBoundaries(text: string, x0: number, x1: number): number[] {
  const out = new Array<number>(text.length + 1);
  let total = 0;
  for (let i = 0; i < text.length; i++) total += charWidth(text[i]);
  const span = x1 - x0;
  let acc = 0;
  out[0] = x0;
  for (let i = 0; i < text.length; i++) {
    acc += charWidth(text[i]);
    out[i + 1] = total > 0 ? x0 + (acc / total) * span : x0 + ((i + 1) / text.length) * span;
  }
  return out;
}
