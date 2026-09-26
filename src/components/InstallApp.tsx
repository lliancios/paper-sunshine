"use client";
import { Download, Share, SquarePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { Modal } from "./ui";

// Chrome, Edge and Android fire `beforeinstallprompt`; keep it so a button can
// open the real install dialog. Safari (iPhone, iPad, Mac) needs manual steps.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
const useInstall = create<{ prompt: InstallPromptEvent | null; installed: boolean }>(() => ({ prompt: null, installed: false }));

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    useInstall.setState({ prompt: e as InstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => useInstall.setState({ prompt: null, installed: true }));
}

type Platform = "ios" | "mac-safari" | "android" | "chromium" | "other";
function platform(): Platform {
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Edg\/|Chrome\//.test(ua)) return "chromium";
  if (/Macintosh/.test(ua) && /Safari\//.test(ua)) return "mac-safari";
  return "other";
}

function standalone() {
  return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Sidebar entry: installs the app (or explains how), hidden once running as the app. */
export function InstallAppButton({ className }: { className?: string }) {
  const prompt = useInstall((s) => s.prompt);
  const installed = useInstall((s) => s.installed);
  const [show, setShow] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [os, setOs] = useState<Platform>("other");

  useEffect(() => {
    setHidden(standalone());
    setOs(platform());
  }, []);
  if (hidden || installed) return null;

  const onClick = async () => {
    if (prompt) {
      await prompt.prompt();
      const choice = await prompt.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") useInstall.setState({ prompt: null, installed: true });
      return;
    }
    setShow(true);
  };

  return (
    <>
      <button type="button" onClick={() => void onClick()} className={className ?? "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-muted"}>
        <Download size={17} className="text-ink-soft" /> 安裝 App
      </button>
      <Modal open={show} onClose={() => setShow(false)} title="把 Paper Sunshine 裝成 App" width={520}>
        <div className="space-y-4 text-sm leading-relaxed">
          <p className="text-ink-soft">裝好後會出現在主畫面或 Dock，全螢幕開啟、不用找分頁；已匯入的論文沒網路也能讀。</p>
          {(os === "ios" || os === "other") && (
            <Steps
              title="iPhone／iPad（Safari）"
              steps={[
                <>
                  點下方或網址列旁的 <Share size={14} className="inline" /> 分享
                </>,
                <>
                  往下滑，選 <SquarePlus size={14} className="inline" />「加入主畫面」
                </>,
                "按「加入」，主畫面就會出現水晶球圖示",
              ]}
            />
          )}
          {(os === "mac-safari" || os === "other") && <Steps title="Mac（Safari 17 以上）" steps={["選單列「檔案」", "「加入 Dock」", "按「加入」，之後從 Dock 或啟動台開啟"]} />}
          {(os === "chromium" || os === "other") && (
            <Steps title="Mac／Windows（Chrome 或 Edge）" steps={["網址列右側的「安裝」圖示（電腦加箭頭）", "或右上角 ⋮ →「投放、儲存及分享」→「安裝 Paper Sunshine」", "裝好會出現在 Dock／開始選單"]} />
          )}
          {(os === "android" || os === "other") && <Steps title="Android（Chrome）" steps={["右上角 ⋮", "「加到主畫面」或「安裝應用程式」"]} />}
        </div>
      </Modal>
    </>
  );
}

function Steps({ title, steps }: { title: string; steps: React.ReactNode[] }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-1.5 font-medium">{title}</div>
      <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
