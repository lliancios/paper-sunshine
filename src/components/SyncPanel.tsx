"use client";
import { CheckCircle2, Cloud, CloudOff, CloudUpload, Download, ExternalLink, Info, Loader2, LogOut, RefreshCw, Stethoscope, XCircle } from "lucide-react";
import { useState } from "react";
import { type Check, diagnose, prefetchPapers, redownloadAll, reuploadAll, signIn, signOut, signUp, syncNow, useSync } from "@/lib/sync";
import { useApp } from "./AppFrame";
import { Button, cx, relTime, toast } from "./ui";

const GUIDE = "https://github.com/lliancios/paper-sunshine#跨裝置同步";

const PHASE: Record<string, string> = {
  off: "未設定",
  signedOut: "未登入",
  idle: "已同步",
  syncing: "同步中…",
  error: "同步出錯",
  offline: "離線中",
};

/** Compact status for the sidebar; opens the sync settings. */
export function SyncBadge() {
  const s = useSync();
  const setApp = useApp((a) => a.set);
  if (!s.configured) return null;
  const bad = s.phase === "error";
  return (
    <button
      type="button"
      onClick={() => setApp({ settingsOpen: true, settingsTab: "sync" })}
      title={s.message || PHASE[s.phase]}
      className={cx("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted", bad ? "text-red-600" : "text-ink-faint")}
    >
      {s.phase === "syncing" ? <Loader2 size={14} className="animate-spin" /> : s.phase === "offline" || s.phase === "signedOut" || bad ? <CloudOff size={14} /> : <Cloud size={14} />}
      <span className="truncate">
        {PHASE[s.phase]}
        {s.phase === "idle" && s.lastSync ? `・${relTime(s.lastSync)}` : ""}
        {s.pending > 0 && s.phase !== "idle" ? `・待上傳 ${s.pending}` : ""}
      </span>
    </button>
  );
}

/** Settings tab: sign in, status, manual sync, offline download. */
export function SyncTab() {
  const s = useSync();
  const health = useApp((a) => a.health);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const what = (
    <p className="text-xs leading-relaxed text-ink-faint">
      會同步：文獻庫與資料夾、PDF、譯文、自動高亮、劃線與評論、解釋、筆記、討論、手寫、一頁速覽、設定。每台裝置用同一組帳號登入即可；沒網路時照常使用，連線後自動補上。
    </p>
  );

  if (!s.configured && !health?.sync)
    return (
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <CloudOff size={16} /> 還沒設定雲端同步
        </div>
        <p className="text-ink-soft">
          同步使用你自己的 Supabase 免費專案（資料只在你的帳號裡）。設定約 5 分鐘：建立專案、執行一段 SQL、把兩個值加到 Vercel 環境變數、重新部署。
        </p>
        <a href={GUIDE} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-strong underline">
          <ExternalLink size={14} /> 看設定步驟
        </a>
        <Diagnostics />
        {what}
      </div>
    );

  if (!s.email)
    return (
      <form
        className="max-w-sm space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void run("in", () => signIn(email.trim(), password));
        }}
      >
        <div className="flex items-center gap-2 font-medium">
          <Cloud size={16} /> 登入同步帳號
        </div>
        <p className="text-ink-soft">第一次使用請按「建立帳號」，其他裝置用同一組 Email 與密碼登入。</p>
        <input className="w-full rounded-lg border border-line bg-bg px-3 py-2" type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input
          className="w-full rounded-lg border border-line bg-bg px-3 py-2"
          type="password"
          autoComplete="current-password"
          placeholder="密碼（至少 6 個字元）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={!email || password.length < 6 || !!busy}>
            {busy === "in" && <Loader2 size={14} className="animate-spin" />} 登入
          </Button>
          <Button
            type="button"
            disabled={!email || password.length < 6 || !!busy}
            onClick={() =>
              void run("up", async () => {
                const r = await signUp(email.trim(), password);
                toast(r === "confirm" ? "已寄出確認信：點信中的連結後，回到這裡登入" : "帳號已建立並登入");
              })
            }
          >
            {busy === "up" && <Loader2 size={14} className="animate-spin" />} 建立帳號
          </Button>
        </div>
        {s.message && <p className="text-xs text-red-600">{s.message}</p>}
        <Diagnostics />
        {what}
      </form>
    );

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-medium">
            {s.phase === "syncing" ? <Loader2 size={15} className="animate-spin" /> : <Cloud size={15} />} {PHASE[s.phase]}
          </div>
          <div className="truncate text-xs text-ink-faint">
            {s.email}
            {s.lastSync ? `・上次同步 ${relTime(s.lastSync)}` : ""}
            {s.pending ? `・待上傳 ${s.pending} 筆` : ""}
          </div>
          {s.message && <div className={cx("mt-1 text-xs", s.phase === "error" ? "text-red-600" : "text-ink-soft")}>{s.message}</div>}
        </div>
        <Button disabled={!!busy} onClick={() => void run("sync", syncNow)}>
          {busy === "sync" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 立即同步
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!!busy}
          onClick={() =>
            void run("dl", async () => {
              await prefetchPapers(10_000, (d, t) => setProgress(`${d}/${t}`));
              setProgress("");
              toast("PDF 都已下載到這台裝置，可以離線閱讀");
            })
          }
        >
          {busy === "dl" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 下載全部 PDF 供離線閱讀 {progress}
        </Button>
        <Button disabled={!!busy} onClick={() => void run("out", signOut)}>
          <LogOut size={14} /> 登出
        </Button>
      </div>
      <Diagnostics />
      <div className="rounded-xl border border-line p-3">
        <div className="mb-1 text-sm font-medium">修復工具</div>
        <p className="mb-2 text-xs text-ink-faint">不會刪除任何資料，重複按也沒關係。</p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!!busy}
            onClick={() =>
              void run("up", async () => {
                await reuploadAll();
                toast("這台裝置的論文與 PDF 已重新上傳");
              })
            }
          >
            {busy === "up" ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />} 重新上傳全部
          </Button>
          <Button
            disabled={!!busy}
            onClick={() =>
              void run("down", async () => {
                await redownloadAll((d, t) => setProgress(`${d}/${t}`));
                setProgress("");
                toast("已從雲端重新下載");
              })
            }
          >
            {busy === "down" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} 從雲端重新下載全部 {busy === "down" ? progress : ""}
          </Button>
        </div>
      </div>
      {what}
      <p className="text-xs text-ink-faint">登出只停止同步，這台裝置上的資料會保留。</p>
    </div>
  );
}

/** "同步診斷": checks each step and says how to fix it. */
function Diagnostics() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setChecks(await diagnose());
    } catch (e) {
      setChecks([{ label: "診斷", ok: false, detail: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">同步診斷</div>
        <Button className="!px-2.5 !py-1 text-xs" disabled={busy} onClick={() => void run()}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Stethoscope size={13} />} {checks ? "重新檢查" : "開始檢查"}
        </Button>
      </div>
      {!checks && <p className="mt-1 text-xs text-ink-faint">看不到其他裝置的論文時按這裡，逐項檢查哪一步出了問題。</p>}
      {checks && (
        <ul className="mt-2 space-y-1.5 text-xs">
          {checks.map((c, i) => (
            <li key={i} className="flex gap-2">
              {c.ok === true ? (
                <CheckCircle2 size={14} className="mt-px shrink-0 text-emerald-600" />
              ) : c.ok === false ? (
                <XCircle size={14} className="mt-px shrink-0 text-red-600" />
              ) : (
                <Info size={14} className="mt-px shrink-0 text-ink-faint" />
              )}
              <div className="min-w-0">
                <span className="font-medium">{c.label}</span>
                <span className="text-ink-soft">：{c.detail}</span>
                {c.fix && <div className="text-red-700 dark:text-red-300">→ {c.fix}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Library banner: this device is not syncing yet (or sync failed). */
export function SyncHint() {
  const s = useSync();
  const setApp = useApp((a) => a.set);
  if (!s.configured || (s.phase !== "signedOut" && s.phase !== "error")) return null;
  const err = s.phase === "error";
  return (
    <button
      type="button"
      onClick={() => setApp({ settingsOpen: true, settingsTab: "sync" })}
      className={cx(
        "mb-4 flex w-full items-center gap-2 rounded-xl border px-4 py-3 text-left text-sm",
        err ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" : "border-accent/40 bg-accent-soft text-accent-strong",
      )}
    >
      {err ? <CloudOff size={16} /> : <Cloud size={16} />}
      <span className="flex-1">{err ? `同步出錯：${s.message}（點這裡診斷）` : "登入同步帳號，就能看到電腦、iPad、手機上的所有論文"}</span>
      <span className="shrink-0 font-medium">{err ? "診斷" : "登入"} →</span>
    </button>
  );
}
