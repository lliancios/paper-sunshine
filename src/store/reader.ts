"use client";
import { create } from "zustand";
import type { Rect } from "@/engine/types";
import type { SelectionInfo } from "@/lib/selection";

export type RightTab = "ai" | "quiz" | "highlights" | "explanations" | "comments" | "notes" | "citations";
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

interface ReaderState {
  viewMode: ViewMode;
  zoom: number | "fit";
  scale: number;
  currentPage: number;
  hoverSid: string | null;
  flash: { sid?: string; page?: number; at: number } | null;
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
  showAuto: boolean;
  scrollToPage: ((page: number, y?: number) => void) | null;
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
  showAuto: true,
  scrollToPage: null,
  chatDraft: null,
  set: (patch) => set(patch),
}));
