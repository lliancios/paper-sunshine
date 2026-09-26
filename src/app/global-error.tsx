"use client";
import { useEffect } from "react";
import { describeError, isChunkError, reloadOnce } from "@/lib/recover";

// Replaces the root layout when it fails, so it cannot rely on globals.css.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    if (isChunkError(error)) reloadOnce();
  }, [error]);
  const btn: React.CSSProperties = { padding: "6px 12px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 14 };
  return (
    <html lang="zh-Hant">
      <body style={{ fontFamily: "system-ui, 'PingFang TC', 'Noto Sans TC', sans-serif", padding: "48px 20px", color: "#1f2328", background: "#fff" }}>
        <title>Paper Sunshine</title>
        <div style={{ maxWidth: 520, margin: "0 auto" }}>
          <h2 style={{ fontSize: 20, marginBottom: 8 }}>Paper Sunshine 出錯了</h2>
          <p style={{ color: "#b91c1c", wordBreak: "break-word" }}>{error.message}</p>
          <p style={{ color: "#6b7280", fontSize: 14 }}>通常重新整理就會恢復；如果一直出現，按「複製錯誤」貼給開發者。</p>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="button" style={btn} onClick={() => retry()}>
              重試
            </button>
            <button type="button" style={btn} onClick={() => location.reload()}>
              重新整理
            </button>
            <button type="button" style={btn} onClick={() => void navigator.clipboard?.writeText(describeError(error))}>
              複製錯誤
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
