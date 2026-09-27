"use client";
import { useMemo } from "react";
import { buildOutline } from "@/engine/outline";
import { printedPage } from "@/lib/citation";
import { useReader } from "@/store/reader";
import { cx } from "../ui";
import { scrollToSentence, useReaderData } from "./ReaderData";

/** Table of contents in the right sidebar; the section being read is marked. */
export function OutlinePanel() {
  const data = useReaderData();
  const current = useReader((s) => s.currentPage);
  const items = useMemo(() => buildOutline(data.model), [data.model]);
  const active = useMemo(() => {
    let a = -1;
    items.forEach((it, i) => {
      if (it.page <= current) a = i;
    });
    return a;
  }, [items, current]);

  if (!items.length) return <div className="p-4 text-sm text-ink-faint">這篇沒有偵測到章節標題。</div>;
  return (
    <nav className="p-2">
      {items.map((it, i) => {
        const s = data.model.sentences[it.sid];
        const zh = data.trans.get(it.sid)?.t;
        const page = printedPage(data.paper, data.model, it.page) ?? String(it.page + 1);
        return (
          <button
            key={it.sid}
            type="button"
            onClick={() => scrollToSentence(data.model, it.sid)}
            className={cx(
              "flex w-full items-baseline gap-2 rounded-lg py-1.5 pr-2 text-left hover:bg-muted",
              it.level === 1 ? "pl-2 text-sm font-medium" : "pl-6 text-[13px]",
              i === active && "bg-accent-soft text-accent-strong",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block">{zh || s.text}</span>
              {zh && <span className="block truncate text-xs font-normal text-ink-faint">{s.text}</span>}
            </span>
            <span className="shrink-0 text-xs font-normal tabular-nums text-ink-faint">p.{page}</span>
          </button>
        );
      })}
    </nav>
  );
}
