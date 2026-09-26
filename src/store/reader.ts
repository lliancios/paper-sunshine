"use client";
import { create } from "zustand";
import type { Rect } from "@/engine/types";
import type { SelectionInfo } from "@/lib/selection";

export type RightTab = "onepager" | "ai" | "quiz" | "highlights" | "explanations" | "comments" | "notes" | "citations";
export type ViewMode = "both" | "src" | "tgt";

export interface ExplainRequest {
  kind: "text";
  selection: SelectionInfo;
}
export interface FigureRequest {
  page: number;
  rect: Rect;
  caption?: string;
}
export interface HighlightPopover {
  id: string;
  x: number;
  y: number;
  editNote?: boolean;
}

export type InkTool = "pen" | "marker" | "eraser";
export interface InkBrush {
  color: string;
  size: number; // page units
}
export interface InkSettings {
  tool: InkTool;
  pen: InkBrush;
  marker: InkBrush;
  /** On touch screens: false = only Apple Pencil writes, fingers scroll. */
  finger: boolean;
}

/** Sentences a citation chip pointed at: outlined on both sides until dismissed. */
export interface FocusMark {
  sids: string[];
  page: number;
  label: string; // "p.71 左欄第 12 行"
  back: { top: number; left: number } | null; // where the reader was before jumping
  at: number;
}

interface ReaderState {
  viewMode: ViewMode;
  zoom: number | "fit";
  scale: number;
  currentPage: number;
  hoverSid: string | null;
  flash: { sid?: string; sids?: string[]; page?: number; at: number } | null;
  selection: SelectionInfo | null;
  explain: ExplainRequest | null;
  translatePop: SelectionInfo | null;
  figure: FigureRequest | null;
  highlightPop: HighlightPopover | null;
  regionMode: boolean;
  rightTab: RightTab | null;
  sidebarBottom: boolean;
  leftOpen: boolean;
  relatedOpen: boolean;
  savedOpen: boolean;
  outlineOpen: boolean;
  infoOpen: boolean;
  searchOpen: boolean;
  onepagerOpen: boolean;
  inkMode: boolean;
  ink: InkSettings;
  showInk: boolean;
  showAuto: boolean;
  panelWidth: number;
  scrollToPage: ((page: number, y?: number, x?: number) => void) | null;
  getScrollPos: (() => { top: number; left: number }) | null;
  setScrollPos: ((pos: { top: number; left: number }) => void) | null;
  focus: FocusMark | null;
  chatDraft: string | null;
  set: (patch: Partial<ReaderState>) => void;
}

export const useReader = create<ReaderState>((set) => ({
  viewMode: "both",
  zoom: "fit",
  scale: 1,
  currentPage: 0,
  hoverSid: null,
  flash: null,
  selection: null,
  explain: null,
  translatePop: null,
  figure: null,
  highlightPop: null,
  regionMode: false,
  rightTab: null,
  sidebarBottom: false,
  leftOpen: true,
  relatedOpen: false,
  savedOpen: false,
  outlineOpen: false,
  infoOpen: false,
  searchOpen: false,
  onepagerOpen: false,
  inkMode: false,
  ink: { tool: "pen", pen: { color: "#1f2937", size: 1.6 }, marker: { color: "#facc15", size: 11 }, finger: false },
  showInk: true,
  showAuto: true,
  panelWidth: (() => {
    try {
      const v = Number(typeof window !== "undefined" ? localStorage.getItem("ps-panel-width") : 0);
      return v >= 300 && v <= 900 ? v : 400;
    } catch {
      return 400;
    }
  })(),
  scrollToPage: null,
  getScrollPos: null,
  setScrollPos: null,
  focus: null,
  chatDraft: null,
  set: (patch) => set(patch),
}));
