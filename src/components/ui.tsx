"use client";
import { Star, X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { create } from "zustand";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function IconButton({
  title,
  onClick,
  active,
  children,
  className,
  disabled,
}: {
  title: string;
  onClick?: () => void;
  active?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-1.5 text-ink-soft transition-colors hover:bg-muted hover:text-ink disabled:opacity-40",
        active && "bg-accent-soft text-accent-strong hover:bg-accent-soft hover:text-accent-strong",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  className,
  disabled,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
        variant === "primary" && "bg-ink text-bg hover:opacity-90",
        variant === "default" && "border border-line bg-bg text-ink hover:bg-muted",
        variant === "ghost" && "text-ink-soft hover:bg-muted hover:text-ink",
        variant === "danger" && "border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 640,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 p-4 pt-[6vh]" onMouseDown={onClose}>
      <div
        className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-line bg-bg shadow-[var(--shadow)]"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="text-base font-semibold">{title}</div>
          <IconButton title="關閉" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="scroll-thin overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("inline-flex rounded-xl bg-muted p-1", className)}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex-1 whitespace-nowrap rounded-lg px-3 py-1 text-sm transition-colors",
            value === o.value ? "bg-bg font-medium text-ink shadow-sm" : "text-ink-soft hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stars({ value, onChange, size = 15 }: { value: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <div className="inline-flex" onClick={(e) => e.stopPropagation()}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button type="button" key={n} title={`${n} 星`} onClick={() => onChange?.(n === value ? 0 : n)} className="p-0.5">
          <Star size={size} className={n <= value ? "fill-amber-400 text-amber-400" : "text-ink-faint"} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="ps-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: "gray" | "amber" | "violet" | "green" | "red" }) {
  const tones = {
    gray: "bg-muted text-ink-soft",
    amber: "bg-accent-soft text-accent-strong",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    red: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  };
  return <span className={cx("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium", tones[tone])}>{children}</span>;
}

export function relTime(ts?: number): string {
  if (!ts) return "";
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "剛剛";
  if (d < 3600) return `${Math.floor(d / 60)} 分鐘前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小時前`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} 天前`;
  return new Date(ts).toLocaleDateString("zh-TW");
}

// ---------------------------------------------------------------- toast ----
interface ToastState {
  items: { id: number; text: string; tone: "info" | "error" }[];
  push: (text: string, tone?: "info" | "error") => void;
}
export const useToast = create<ToastState>((set) => ({
  items: [],
  push: (text, tone = "info") => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items, { id, text, tone }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), tone === "error" ? 6000 : 2600);
  },
}));
export const toast = (text: string, tone: "info" | "error" = "info") => useToast.getState().push(text, tone);

export function Toasts() {
  const items = useToast((s) => s.items);
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cx(
            "rounded-xl px-4 py-2 text-sm shadow-[var(--shadow)]",
            t.tone === "error" ? "bg-red-600 text-white" : "bg-ink text-bg",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export async function copyText(text: string, label = "已複製") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("無法存取剪貼簿", "error");
  }
}
