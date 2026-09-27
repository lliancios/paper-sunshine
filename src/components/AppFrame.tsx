"use client";
import { KeyRound, RefreshCw, WifiOff } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { health, setPasscode } from "@/lib/api";
import type { HealthResponse } from "@/lib/apiTypes";
import { resumeAll } from "@/lib/pipeline";
import { startSync } from "@/lib/sync";
import { useSettings } from "@/lib/settings";
import { BUILD_ID, installRecovery } from "@/lib/recover";
import { APP_VERSION } from "@/lib/version";
import { SettingsDialog } from "./SettingsDialog";
import { SunMark } from "./SunMark";
import { Button, Toasts } from "./ui";

interface AppState {
  settingsOpen: boolean;
  health: HealthResponse | null;
  newVersion: boolean;
  /** Tab to show when the settings dialog opens (e.g. "sync"). */
  settingsTab?: string;
  set: (p: Partial<AppState>) => void;
}
export const useApp = create<AppState>((set) => ({ settingsOpen: false, health: null, newVersion: false, set: (p) => set(p) }));

function useTheme() {
  const { theme, hoverStyle } = useSettings();
  useEffect(() => {
    document.documentElement.dataset.hover = hoverStyle ?? "gray";
  }, [hoverStyle]);
  useEffect(() => {
    try {
      localStorage.setItem("ps-theme", theme);
    } catch {
      /* ignore */
    }
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

/** After the passcode check: start cross-device sync (first pull), then resume background jobs. */
async function afterAuth(r: HealthResponse | null) {
  if (r && !r.authorized) return;
  await startSync(r?.sync ?? null).catch(() => {});
  if (r?.authorized) void resumeAll();
}

export function AppFrame({ children }: { children: ReactNode }) {
  useTheme();
  const { health: h, settingsOpen, newVersion, set } = useApp();
  const [pass, setPass] = useState("");
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    try {
      const r = await health();
      // A newer deploy is live: offer a reload (old pages can break on missing code files).
      set({ health: r, ...(r.build && BUILD_ID && r.build !== BUILD_ID && process.env.NODE_ENV === "production" ? { newVersion: true } : {}) });
      return r;
    } catch {
      return null;
    }
  }, [set]);

  useEffect(() => {
    installRecovery();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(() => void check(), 10 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [check]);

  useEffect(() => {
    void check().then((r) => afterAuth(r));
  }, [check]);

  // Installed-app support: offline shell + resume background jobs when the network returns.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`).catch(() => {});
    }
    const sync = () => setOffline(!navigator.onLine);
    const online = () => {
      sync();
      void check().then((r) => afterAuth(r));
    };
    sync();
    window.addEventListener("online", online);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", sync);
    };
  }, [check]);

  const locked = h ? h.passcodeRequired && !h.authorized && !offline : false;

  return (
    <>
      {children}
      <SettingsDialog open={settingsOpen} onClose={() => set({ settingsOpen: false, settingsTab: undefined })} />
      <Toasts />
      {newVersion && !offline && (
        <button
          type="button"
          onClick={() => location.reload()}
          className="fixed bottom-3 left-1/2 z-[140] flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-4 py-2 text-xs text-bg shadow-[var(--shadow)] hover:opacity-90"
        >
          <RefreshCw size={13} /> Paper Sunshine 有新版本，點這裡重新整理
        </button>
      )}
      {offline && (
        <div className="pointer-events-none fixed bottom-3 left-1/2 z-[140] flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink/85 px-3.5 py-1.5 text-xs text-bg shadow-[var(--shadow)]">
          <WifiOff size={13} /> 離線中：可閱讀已匯入的論文，翻譯與 AI 功能連線後自動繼續
        </div>
      )}
      {locked && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-bg/90 p-4 backdrop-blur">
          <form
            className="w-full max-w-sm rounded-2xl border border-line bg-bg p-6 shadow-[var(--shadow)]"
            onSubmit={async (e) => {
              e.preventDefault();
              setChecking(true);
              setPasscode(pass);
              const r = await check();
              setChecking(false);
              if (r?.authorized) void afterAuth(r);
            }}
          >
            <div className="mb-4 flex items-center gap-3">
              <SunMark size={36} />
              <div>
                <div className="font-semibold">Paper Sunshine</div>
                <div className="text-sm text-ink-soft">請輸入你在 Vercel 設定的 APP_PASSCODE</div>
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
              <KeyRound size={16} className="text-ink-faint" />
              <input
                autoFocus
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                className="w-full bg-transparent text-sm outline-none"
                placeholder="Passcode"
              />
            </label>
            {h && !h.authorized && pass && !checking && <div className="mt-2 text-xs text-red-600">密碼不正確</div>}
            <Button type="submit" variant="primary" className="mt-4 w-full" disabled={!pass || checking}>
              {checking ? "驗證中…" : "進入"}
            </Button>
            <p className="mt-3 text-xs text-ink-faint">密碼只存在這台裝置的瀏覽器中。</p>
          </form>
        </div>
      )}
    </>
  );
}
