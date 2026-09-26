"use client";
import { AlertTriangle, Copy, RefreshCw, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { describeError, isChunkError, reloadOnce } from "@/lib/recover";

/** Error card with retry, reload and copy-details actions. */
export function ErrorCard({ error, label, onRetry, compact }: { error: unknown; label?: string; onRetry?: () => void; compact?: boolean }) {
  const detail = describeError(error);
  const message = (error as { message?: string } | null)?.message ?? String(error);
  return (
    <div className={compact ? "m-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40" : "mx-auto my-16 max-w-lg rounded-2xl border border-red-200 bg-red-50 p-5 text-sm dark:border-red-900 dark:bg-red-950/40"}>
      <div className="mb-1 flex items-center gap-2 font-semibold text-red-700 dark:text-red-300">
        <AlertTriangle size={16} /> {label ? `「${label}」出錯了` : "這個畫面出錯了"}
      </div>
      <p className="mb-3 break-words text-red-700/90 dark:text-red-300/90">{message}</p>
      <div className="flex flex-wrap gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs hover:bg-red-100 dark:border-red-900 dark:bg-transparent">
            <RotateCcw size={12} /> 重試
          </button>
        )}
        <button type="button" onClick={() => location.reload()} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs hover:bg-red-100 dark:border-red-900 dark:bg-transparent">
          <RefreshCw size={12} /> 重新整理
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(detail)}
          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs hover:bg-red-100 dark:border-red-900 dark:bg-transparent"
          title="複製後貼給開發者"
        >
          <Copy size={12} /> 複製錯誤
        </button>
      </div>
    </div>
  );
}

interface Props {
  children: ReactNode;
  label?: string;
  compact?: boolean;
  /** Render nothing on error (for floating popovers), after logging. */
  silent?: boolean;
  resetKey?: unknown;
}
interface State {
  error: unknown;
  key: unknown;
}

/**
 * Keeps a failing panel from taking down the whole page. A code file missing
 * after a new deploy triggers one automatic reload instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[${this.props.label ?? "boundary"}]`, error, info.componentStack);
    if (isChunkError(error)) reloadOnce();
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.silent) return null;
    return <ErrorCard error={this.state.error} label={this.props.label} compact={this.props.compact} onRetry={() => this.setState({ error: null })} />;
  }
}
