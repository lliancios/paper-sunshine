"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { createContext, useContext, useMemo } from "react";
import type { Overview } from "@/lib/apiTypes";
import { type AppSettings, type Explanation, type Highlight, type JobRec, type Paper, db } from "@/lib/db";
import { HIGHLIGHT_COLORS } from "@/lib/defaults";
import { useSettings } from "@/lib/settings";
import { useReader } from "@/store/reader";
import type { DocModel, Piece } from "@/engine/types";
import { lineLabel, lineOf } from "@/engine/lines";
import { printedPage } from "@/lib/citation";

export interface Trans {
  t: string;
  c: string | null;
  mock?: boolean;
}

export interface ReaderData {
  paperId: string;
  paper: Paper;
  model: DocModel;
  trans: Map<string, Trans>;
  cats: Map<string, string>; // auto-highlight category per sentence
  pagesDone: Set<number>;
  highlights: Highlight[];
  explanations: Explanation[];
  hlBySid: Map<string, Highlight[]>;
  exBySid: Map<string, Explanation[]>;
  piecesByPage: Map<number, { sid: string; pc: Piece }[]>;
  overview?: Overview;
  job?: JobRec;
  settings: AppSettings;
  catColor: (key: string) => string;
}

const Ctx = createContext<ReaderData | null>(null);

export function useReaderData(): ReaderData {
  const v = useContext(Ctx);
  if (!v) throw new Error("ReaderData missing");
  return v;
}

export function hlColor(key: string) {
  return HIGHLIGHT_COLORS.find((c) => c.key === key)?.color ?? "#facc15";
}

export function rgba(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Loads everything the reader needs; returns null while loading. */
export function useLoadReaderData(paperId: string): ReaderData | null | "missing" {
  const settings = useSettings();
  const paper = useLiveQuery(() => db.papers.get(paperId), [paperId], null);
  const modelRec = useLiveQuery(() => db.models.get(paperId), [paperId], null);
  const transRecs = useLiveQuery(() => db.translations.where("paperId").equals(paperId).toArray(), [paperId]);
  const hlRecs = useLiveQuery(() => db.autohl.where("paperId").equals(paperId).toArray(), [paperId]);
  const statusRecs = useLiveQuery(() => db.pageStatus.where("paperId").equals(paperId).toArray(), [paperId]);
  const highlights = useLiveQuery(() => db.highlights.where("paperId").equals(paperId).filter((h) => !h.deleted).toArray(), [paperId]);
  const explanations = useLiveQuery(() => db.explanations.where("paperId").equals(paperId).filter((e) => !e.deleted).toArray(), [paperId]);
  const overview = useLiveQuery(() => db.overviews.get(paperId), [paperId]);
  const job = useLiveQuery(() => db.jobs.get(paperId), [paperId]);

  const model = modelRec?.model;
  const trans = useMemo(() => new Map((transRecs ?? []).filter((r) => r.t).map((r) => [r.sid, { t: r.t, c: r.c, mock: r.mock }])), [transRecs]);
  const cats = useMemo(() => {
    const m = new Map<string, string>();
    if (hlRecs?.length) for (const r of hlRecs) m.set(r.sid, r.c);
    else for (const r of transRecs ?? []) if (r.c) m.set(r.sid, r.c); // legacy v0.1 per-page categories
    return m;
  }, [transRecs, hlRecs]);
  const pagesDone = useMemo(() => new Set((statusRecs ?? []).filter((s) => s.done).map((s) => s.page)), [statusRecs]);
  const hlBySid = useMemo(() => {
    const m = new Map<string, Highlight[]>();
    for (const h of highlights ?? []) for (const r of h.ranges) m.set(r.sid, [...(m.get(r.sid) ?? []), h]);
    return m;
  }, [highlights]);
  const exBySid = useMemo(() => {
    const m = new Map<string, Explanation[]>();
    for (const e of explanations ?? []) for (const r of e.ranges ?? []) m.set(r.sid, [...(m.get(r.sid) ?? []), e]);
    return m;
  }, [explanations]);
  const piecesByPage = useMemo(() => {
    const m = new Map<number, { sid: string; pc: Piece }[]>();
    if (!model) return m;
    for (const sid of model.order) {
      for (const pc of model.sentences[sid].pieces) {
        const list = m.get(pc.p) ?? [];
        list.push({ sid, pc });
        m.set(pc.p, list);
      }
    }
    return m;
  }, [model]);
  const catColor = useMemo(() => {
    const map = new Map(settings.categories.map((c) => [c.key, c.color]));
    return (key: string) => map.get(key) ?? "#94a3b8";
  }, [settings.categories]);

  return useMemo(() => {
    if (paper === null || modelRec === null) return null; // loading
    if (!paper || paper.deleted) return "missing";
    if (!model) return null;
    return {
      paperId,
      paper,
      model,
      trans,
      cats,
      pagesDone,
      highlights: highlights ?? [],
      explanations: explanations ?? [],
      hlBySid,
      exBySid,
      piecesByPage,
      overview: overview?.data,
      job,
      settings,
      catColor,
    };
  }, [paperId, paper, modelRec, model, trans, cats, pagesDone, highlights, explanations, hlBySid, exBySid, piecesByPage, overview, job, settings, catColor]);
}

export const ReaderDataProvider = Ctx.Provider;

/** Page + y of a sentence offset, for scrolling and citations. */
export function locate(model: DocModel, sid: string, off = 0): { page: number; y: number } | null {
  const s = model.sentences[sid];
  if (!s) return null;
  const pc = s.pieces.find((p) => off >= p.s && off < p.e) ?? s.pieces[0];
  if (!pc) return { page: s.p, y: 0 };
  return { page: pc.p, y: pc.r[1] };
}

export function scrollToSentence(model: DocModel, sid: string, off = 0) {
  const loc = locate(model, sid, off);
  if (!loc) return;
  const st = useReader.getState();
  st.scrollToPage?.(loc.page, loc.y);
  st.set({ flash: { sid, at: Date.now() } });
}

/**
 * Jumps to cited sentences and keeps them outlined on both sides (until the
 * reader dismisses it), with a "p.71 左欄第 12 行" tag and a way back.
 */
export function scrollToSentences(model: DocModel, sids: string[], paper?: Paper) {
  const ok = sids.filter((s) => model.sentences[s]);
  if (!ok.length) return;
  const first = model.sentences[ok[0]];
  const pc = first.pieces[0];
  if (!pc) return;
  const st = useReader.getState();
  const pos = lineOf(model, ok[0]);
  const page = pos?.page ?? pc.p;
  const label = `p.${printedPage(paper, model, page) ?? page + 1}${pos ? ` ${lineLabel(pos)}` : ""}${ok.length > 1 ? `（共 ${ok.length} 句）` : ""}`;
  const back = st.focus?.back ?? st.getScrollPos?.() ?? null;
  st.scrollToPage?.(page, Math.max(0, pc.r[1] - 30), pc.r[0]);
  st.set({ focus: { sids: ok, page, label, back, at: Date.now() }, flash: { sid: ok[0], sids: ok, at: Date.now() } });
}

/** Clears the citation focus; optionally returns to where the reader was. */
export function clearFocus(goBack = false) {
  const st = useReader.getState();
  if (goBack && st.focus?.back) st.setScrollPos?.(st.focus.back);
  st.set({ focus: null });
}
