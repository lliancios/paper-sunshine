"use client";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { friendlyError, getPasscode, postJson, setPasscode } from "@/lib/api";
import { download } from "@/lib/citation";
import { type AppSettings, db } from "@/lib/db";
import {
  COLOR_SCHEMES,
  DEFAULT_CATEGORIES,
  DEFAULT_JOURNALS,
  DEFAULT_RESEARCH_CONTEXT,
  DEFAULT_ROLE_PROMPT,
  MODEL_PRESETS,
  TARGET_LANGUAGES,
  TIER_LABEL,
  type Journal,
} from "@/lib/defaults";
import { unpause } from "@/lib/pipeline";
import { DEFAULT_SETTINGS, models, saveSettings, useSettings } from "@/lib/settings";
import { APP_VERSION } from "@/lib/version";
import { useApp } from "./AppFrame";
import { Badge, Button, Modal, Segmented, cx, toast } from "./ui";
import { SyncTab } from "./SyncPanel";

type Tab = "general" | "sync" | "models" | "prompt" | "research" | "categories" | "journals" | "data";

const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "一般" },
  { key: "sync", label: "跨裝置同步" },
  { key: "models", label: "模型與連線" },
  { key: "prompt", label: "翻譯角色提示詞" },
  { key: "research", label: "研究脈絡" },
  { key: "categories", label: "自動高亮分類" },
  { key: "journals", label: "期刊白名單" },
  { key: "data", label: "資料" },
];

const input = "w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const saved = useSettings();
  const health = useApp((s) => s.health);
  const wantTab = useApp((s) => s.settingsTab);
  const [tab, setTab] = useState<Tab>("general");
  const [draft, setDraft] = useState<AppSettings>(saved);
  const [pass, setPass] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(saved);
      setPass(getPasscode());
      if (wantTab && TABS.some((t) => t.key === wantTab)) setTab(wantTab as Tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const up = (p: Partial<AppSettings>) => setDraft((d) => ({ ...d, ...p }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async () => {
    const before = models(saved);
    await saveSettings(draft);
    if (pass !== getPasscode()) setPasscode(pass);
    const after = models(draft);
    if (before.translate !== after.translate || before.chat !== after.chat) {
      // A new model has its own quota: resume papers paused by the old one.
      const paused = await db.jobs.filter((j) => j.stage === "paused").toArray();
      for (const j of paused) await unpause(j.paperId);
      toast(paused.length ? `設定已儲存，${paused.length} 篇暫停的論文已用新模型繼續` : "設定已儲存");
    } else toast("設定已儲存");
  };

  return (
    <Modal open={open} onClose={onClose} title="設定" width={860}>
      <div className="flex flex-col gap-5 md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-40 md:flex-col">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cx(
                "whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm",
                tab === t.key ? "bg-accent-soft font-medium text-accent-strong" : "text-ink-soft hover:bg-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-5">
          {tab === "general" && (
            <>
              <Field label="網站密碼（APP_PASSCODE）" hint="只存在這台裝置。">
                <input className={input} type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
              </Field>
              <Field label="翻譯語言">
                <select className={input} value={draft.targetLanguage} onChange={(e) => up({ targetLanguage: e.target.value })}>
                  {TARGET_LANGUAGES.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </Field>
              <Toggle label="上傳後自動翻譯整篇並產生自動高亮" value={draft.autoTranslate} onChange={(v) => up({ autoTranslate: v })} />
              <Toggle label="自動高亮（全文一次標完，只花 1 次請求）" value={draft.autoHighlight} onChange={(v) => up({ autoHighlight: v })} />
              <Toggle label="翻譯完成後自動產生一頁速覽" value={draft.autoOnepager} onChange={(v) => up({ autoOnepager: v })} />
              <Field label="句子對照框顏色" hint="滑鼠停在句子上時，兩側同一句的底色">
                <Segmented
                  value={draft.hoverStyle}
                  onChange={(v) => up({ hoverStyle: v })}
                  options={[
                    { value: "gray", label: "灰色反光" },
                    { value: "green", label: "綠色" },
                    { value: "amber", label: "琥珀" },
                  ]}
                />
              </Field>
              <Field label="自動高亮配色">
                <Segmented value={draft.colorScheme} onChange={(v) => up({ colorScheme: v })} options={COLOR_SCHEMES.map((c) => ({ value: c.key, label: c.label }))} />
              </Field>
              <Field label="外觀">
                <Segmented
                  value={draft.theme}
                  onChange={(v) => up({ theme: v })}
                  options={[
                    { value: "system", label: "跟隨系統" },
                    { value: "light", label: "淺色" },
                    { value: "dark", label: "深色" },
                  ]}
                />
              </Field>
            </>
          )}

          {tab === "sync" && <SyncTab />}

          {tab === "models" && <ModelsTab draft={draft} up={up} />}

          {tab === "prompt" && (
            <Field
              label="翻譯角色提示詞"
              hint="{targetLanguage} 會替換成翻譯語言。輸出格式與逐句對齊由系統鎖定，你怎麼改這裡都不會打壞同步高亮。"
              action={<ResetBtn onClick={() => up({ rolePrompt: DEFAULT_ROLE_PROMPT })} />}
            >
              <textarea className={cx(input, "h-[52vh] font-mono text-xs leading-relaxed")} value={draft.rolePrompt} onChange={(e) => up({ rolePrompt: e.target.value })} />
            </Field>
          )}

          {tab === "research" && (
            <>
              <Field label="研究脈絡" hint="用於解釋、討論與相關論文排序；翻譯不會用到。" action={<ResetBtn onClick={() => up({ researchContext: DEFAULT_RESEARCH_CONTEXT })} />}>
                <textarea className={cx(input, "h-56 text-sm leading-relaxed")} value={draft.researchContext} onChange={(e) => up({ researchContext: e.target.value })} />
              </Field>
              <Field label="研究主題搜尋詞（英文，每行一組，最多用前兩組）" hint="相關論文會額外用這些詞在白名單期刊中搜尋。">
                <textarea
                  className={cx(input, "h-24 text-sm")}
                  value={draft.scholarQueries.join("\n")}
                  onChange={(e) => up({ scholarQueries: e.target.value.split("\n") })}
                />
              </Field>
              <Toggle label="相關論文預設只顯示白名單期刊" value={draft.onlyWhitelist} onChange={(v) => up({ onlyWhitelist: v })} />
            </>
          )}

          {tab === "categories" && (
            <Field label="自動高亮分類" hint="改完後，新翻譯的頁面才會套用。" action={<ResetBtn onClick={() => up({ categories: DEFAULT_CATEGORIES })} />}>
              <div className="space-y-2">
                {draft.categories.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="color" value={c.color} onChange={(e) => up({ categories: draft.categories.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} className="h-8 w-8 shrink-0 rounded border border-line" />
                    <input className={cx(input, "w-28")} value={c.label} onChange={(e) => up({ categories: draft.categories.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <input className={input} value={c.description} onChange={(e) => up({ categories: draft.categories.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
                    <button type="button" title="刪除" className="text-ink-faint hover:text-red-600" onClick={() => up({ categories: draft.categories.filter((_, j) => j !== i) })}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  onClick={() =>
                    up({ categories: [...draft.categories, { key: `c${Date.now().toString(36)}`, label: "新分類", description: "描述這類句子", color: "#64748b" }] })
                  }
                >
                  <Plus size={15} /> 新增分類
                </Button>
              </div>
            </Field>
          )}

          {tab === "journals" && <JournalEditor journals={draft.journals} onChange={(journals) => up({ journals })} />}

          {tab === "data" && <DataTools />}

          {tab !== "data" && (
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-bg pt-3">
              <Button variant="ghost" onClick={() => setDraft({ ...DEFAULT_SETTINGS, theme: draft.theme })}>
                全部還原預設
              </Button>
              <Button variant="primary" disabled={!dirty && pass === getPasscode()} onClick={save}>
                儲存設定
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ModelsTab({ draft, up }: { draft: AppSettings; up: (p: Partial<AppSettings>) => void }) {
  const health = useApp((s) => s.health);
  const [checks, setChecks] = useState<{ name: string; ok: boolean; ms: number; detail: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const cur = models(draft);
  const preset = MODEL_PRESETS.find((p) => p.translate === cur.translate && p.chat === cur.chat)?.key ?? "custom";
  const run = async () => {
    setBusy(true);
    setChecks(null);
    try {
      const r = await postJson<{ checks: { name: string; ok: boolean; ms: number; detail: string }[] }>("/api/diagnose", cur);
      setChecks(r.checks);
    } catch (e) {
      setChecks([{ name: "診斷", ok: false, ms: 0, detail: friendlyError(e) }]);
    } finally {
      setBusy(false);
    }
  };
  const providers = health?.providers ?? {};
  return (
    <>
      <Field label="伺服器上已設定的金鑰" hint="金鑰只放在 Vercel 的環境變數，不會送到瀏覽器。">
        <div className="flex flex-wrap gap-1.5 text-sm">
          {Object.entries({ gemini: "Gemini", deepseek: "DeepSeek", openrouter: "OpenRouter", siliconflow: "SiliconFlow", groq: "Groq", custom: "自訂" }).map(([k, label]) => (
            <Badge key={k} tone={providers[k] ? "green" : "gray"}>
              {label} {providers[k] ? "✓" : "未設定"}
            </Badge>
          ))}
          <Badge tone={health?.openalex ? "green" : "red"}>OpenAlex {health?.openalex ? "✓" : "未設定"}</Badge>
          <Badge tone="gray">v{APP_VERSION}</Badge>
        </div>
      </Field>
      <Field label="模型方案">
        <div className="space-y-2">
          {MODEL_PRESETS.map((p) => (
            <label key={p.key} className={cx("flex cursor-pointer gap-3 rounded-xl border p-3", preset === p.key ? "border-accent bg-accent-soft" : "border-line hover:bg-muted")}>
              <input type="radio" checked={preset === p.key} onChange={() => up({ modelTranslate: p.translate, modelChat: p.chat })} className="mt-1" />
              <div className="min-w-0 text-sm">
                <div className="font-medium">
                  {p.label} <span className="text-xs font-normal text-ink-faint">需要 {p.needs}</span>
                </div>
                <div className="text-xs text-ink-soft">{p.hint}</div>
              </div>
            </label>
          ))}
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="翻譯、高亮、相關論文" hint="格式：提供者:模型，例如 gemini:gemini-3.5-flash-lite">
          <input className={input} value={draft.modelTranslate} onChange={(e) => up({ modelTranslate: e.target.value.trim() })} />
        </Field>
        <Field label="解釋、討論、速覽、圖表" hint="圖表解讀需支援圖片的模型">
          <input className={input} value={draft.modelChat} onChange={(e) => up({ modelChat: e.target.value.trim() })} />
        </Field>
      </div>
      <Field label="同時翻譯批次數" hint="每批約 3 到 4 頁。遇到「請求太頻繁」時調成 1。">
        <input className={input} type="number" min={1} max={4} value={draft.concurrency} onChange={(e) => up({ concurrency: Number(e.target.value) || 1 })} />
      </Field>
      <Field label="連線診斷" hint="用目前填的模型實際呼叫一次，確認金鑰、模型名稱與額度。記得先儲存設定。">
        <Button onClick={run} disabled={busy}>
          {busy ? "測試中…" : "執行診斷"}
        </Button>
        {checks && (
          <div className="mt-3 divide-y divide-line rounded-xl border border-line text-sm">
            {checks.map((c) => (
              <div key={c.name} className="flex items-start gap-2 px-3 py-2">
                <span className={c.ok ? "text-emerald-600" : "text-red-600"}>{c.ok ? "✓" : "✗"}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {c.name} <span className="text-xs font-normal text-ink-faint">{c.ms} ms</span>
                  </div>
                  <div className="break-words text-xs text-ink-soft">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Field>
    </>
  );
}

function Field({ label, hint, action, children }: { label: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{label}</div>
        {action}
      </div>
      {children}
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cx("relative h-6 w-11 shrink-0 rounded-full transition-colors", value ? "bg-accent" : "bg-line")}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", value ? "left-[22px]" : "left-0.5")} />
      </button>
    </label>
  );
}

function ResetBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs text-ink-soft hover:text-ink">
      <RotateCcw size={12} /> 還原預設
    </button>
  );
}

function JournalEditor({ journals, onChange }: { journals: Journal[]; onChange: (j: Journal[]) => void }) {
  const [name, setName] = useState("");
  const [issn, setIssn] = useState("");
  const [tier, setTier] = useState<1 | 2 | 3>(1);
  const sorted = [...journals].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  return (
    <Field
      label="期刊白名單"
      hint="以 ISSN 比對，ISSN 對不上時改用期刊名稱比對。老師推薦的期刊請設為第 1 層。"
      action={<ResetBtn onClick={() => onChange(DEFAULT_JOURNALS)} />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={cx(input, "min-w-48 flex-1")} placeholder="期刊名稱，例如 Journal of Marketing" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={cx(input, "w-36")} placeholder="ISSN 0022-2429" value={issn} onChange={(e) => setIssn(e.target.value)} />
        <select className={cx(input, "w-28")} value={tier} onChange={(e) => setTier(Number(e.target.value) as 1 | 2 | 3)}>
          <option value={1}>老師推薦</option>
          <option value={2}>頂尖期刊</option>
          <option value={3}>白名單</option>
        </select>
        <Button
          disabled={!name.trim()}
          onClick={() => {
            onChange([...journals, { name: name.trim(), issn: issn.split(/[,\s]+/).filter(Boolean), tier, field: "marketing" }]);
            setName("");
            setIssn("");
          }}
        >
          <Plus size={15} /> 加入
        </Button>
      </div>
      <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-line">
        {sorted.map((j) => (
          <div key={j.name} className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm last:border-0">
            <select
              className="rounded-md border border-line bg-bg px-1 py-0.5 text-xs"
              value={j.tier}
              onChange={(e) => onChange(journals.map((x) => (x.name === j.name ? { ...x, tier: Number(e.target.value) as 1 | 2 | 3 } : x)))}
            >
              {[1, 2, 3].map((t) => (
                <option key={t} value={t}>
                  {TIER_LABEL[t]}
                </option>
              ))}
            </select>
            <span className="flex-1">{j.name}</span>
            <span className="font-mono text-xs text-ink-faint">{j.issn.join(" · ")}</span>
            <button type="button" title="移除" className="text-ink-faint hover:text-red-600" onClick={() => onChange(journals.filter((x) => x.name !== j.name))}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </Field>
  );
}

function DataTools() {
  const exportAll = async () => {
    const data = {
      app: "paper-sunshine",
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      papers: await db.papers.toArray(),
      highlights: await db.highlights.toArray(),
      explanations: await db.explanations.toArray(),
      notes: await db.notes.toArray(),
      chats: await db.chats.toArray(),
      folders: await db.folders.toArray(),
      saved: await db.saved.toArray(),
      settings: await db.settings.toArray(),
      overviews: await db.overviews.toArray(),
      translations: await db.translations.toArray(),
    };
    download(`paper-sunshine-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), "application/json");
  };
  const importAll = async (file: File) => {
    const data = JSON.parse(await file.text()) as Record<string, unknown[]>;
    if ((data as unknown as { app?: string }).app !== "paper-sunshine") return toast("不是 Paper Sunshine 的備份檔", "error");
    const tables = ["papers", "highlights", "explanations", "notes", "chats", "folders", "saved", "settings", "overviews", "translations"] as const;
    for (const t of tables) {
      const rows = data[t];
      if (Array.isArray(rows)) await (db[t] as unknown as { bulkPut: (r: unknown[]) => Promise<unknown> }).bulkPut(rows);
    }
    toast("匯入完成（PDF 檔案需重新上傳）");
  };
  return (
    <div className="space-y-4 text-sm">
      <p className="text-ink-soft">
        v0.1.0 的資料存在這台裝置的瀏覽器裡。v0.2.0 會接上雲端同步，讓電腦、iPad、手機即時看到同一份劃線。在那之前，可以用備份檔在裝置之間搬移。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={exportAll}>匯出備份（不含 PDF）</Button>
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-muted">
          匯入備份
          <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])} />
        </label>
      </div>
    </div>
  );
}
