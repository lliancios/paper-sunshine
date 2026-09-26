"use client";
import { KeyRound } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { health, setPasscode } from "@/lib/api";
import type { HealthResponse } from "@/lib/apiTypes";
import { resumeAll } from "@/lib/pipeline";
import { useSettings } from "@/lib/settings";
import { SettingsDialog } from "./SettingsDialog";
import { SunMark } from "./SunMark";
import { Button, Toasts } from "./ui";

interface AppState {
  settingsOpen: boolean;
  health: HealthResponse | null;
  set: (p: Partial<AppState>) => void;
}
export const useApp = create<AppState>((set) => ({ settingsOpen: false, health: null, set: (p) => set(p) }));

function useTheme() {
  const { theme } = useSettings();
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

export function AppFrame({ children }: { children: ReactNode }) {
  useTheme();
  const { health: h, settingsOpen, set } = useApp();
  const [pass, setPass] = useState("");
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    try {
      const r = await health();
      set({ health: r });
      return r;
    } catch {
      return null;
    }
  }, [set]);

  useEffect(() => {
    void check().then((r) => {
      if (r && r.authorized) void resumeAll();
    });
  }, [check]);

  const locked = h ? h.passcodeRequired && !h.authorized : false;

  return (
    <>
      {children}
      <SettingsDialog open={settingsOpen} onClose={() => set({ settingsOpen: false })} />
      <Toasts />
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
              if (r?.authorized) void resumeAll();
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
