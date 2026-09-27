/** The "一句話結論" line of a one-page summary, as plain text (for library rows). */
export function conclusionOf(md: string): string {
  const m = /##\s*一句話結論[^\n]*\n+([\s\S]*?)(?=\n##|$)/.exec(md);
  const block = m?.[1] ?? md.split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) ?? "";
  return block
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
