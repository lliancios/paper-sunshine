// Copies the pdf.js worker, CMaps, standard fonts, image decoders (wasm: JBIG2,
// CCITT and JPEG 2000 scans, e.g. JSTOR) and ICC profiles into /public so the
// browser can load them from our own origin (works offline and on iPad).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let root;
try {
  root = dirname(require.resolve("pdfjs-dist/package.json"));
} catch {
  console.warn("[copy-pdfjs-assets] pdfjs-dist not installed yet, skipping");
  process.exit(0);
}
const out = join(process.cwd(), "public", "pdfjs");
mkdirSync(out, { recursive: true });
const worker = join(root, "legacy", "build", "pdf.worker.min.mjs");
if (existsSync(worker)) cpSync(worker, join(out, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const src = join(root, dir);
  if (existsSync(src)) cpSync(src, join(out, dir), { recursive: true });
}
console.log("[copy-pdfjs-assets] copied to public/pdfjs");
