// Core document model. Everything in Paper Sunshine (translation, highlights,
// explanations, hover sync) is keyed by sentence ID, never by screen position.
// That is what lets the source side and the translated side share one set of
// annotations.

/** [x0, y0, x1, y1] in PDF page units at scale 1, origin top-left. */
export type Rect = [number, number, number, number];

/** A text run as delivered by pdf.js, normalised to top-left coordinates. */
export interface RawItem {
  str: string;
  x: number;
  y: number; // top
  w: number;
  h: number; // glyph box height
  base: number; // baseline (top-left origin)
  fs: number; // font size
  font: string; // pdf.js font id
}

/**
 * A contiguous run of one sentence inside one pdf.js text item.
 * The run's text is always `sentence.text.slice(s, e)`.
 */
export interface Piece {
  s: number;
  e: number;
  p: number; // page index
  r: Rect;
  fs: number;
}

export type BlockKind = "para" | "heading" | "caption" | "label" | "skip";

export interface Block {
  id: string; // `${page}-${n}`
  p: number;
  r: Rect;
  kind: BlockKind;
  fs: number;
  lh: number; // average baseline pitch
  nl: number; // number of lines
  sids: string[]; // sentences whose translation is shown in this block
  text?: string; // only kept for skip blocks (headers/footers)
  centered?: boolean;
}

export interface Sentence {
  id: string;
  p: number; // home page
  b: string; // home block id
  kind: BlockKind;
  text: string;
  pieces: Piece[];
}

export interface PageInfo {
  i: number;
  w: number;
  h: number;
  blocks: Block[];
}

export interface DocModel {
  v: 1;
  ev?: number; // engine version that produced this model
  pages: PageInfo[];
  sentences: Record<string, Sentence>;
  order: string[]; // reading order across the document
  bodyFs: number;
  info: {
    doi?: string;
    title?: string; // best guess from layout
    pdfTitle?: string; // from PDF metadata
    pageNumbers: (number | null)[]; // detected printed page number per page
    pageOffset: number | null; // printed = index + offset
  };
}

/** A range inside one sentence, on one side (source or translation). */
export interface SentRange {
  sid: string;
  start: number;
  end: number;
}

export type Side = "src" | "tgt";
