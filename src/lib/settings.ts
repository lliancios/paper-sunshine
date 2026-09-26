"use client";
import { useLiveQuery } from "dexie-react-hooks";
import { type AppSettings, db } from "./db";
import { DEFAULT_CATEGORIES, DEFAULT_JOURNALS, DEFAULT_RESEARCH_CONTEXT, DEFAULT_ROLE_PROMPT, TARGET_LANGUAGES } from "./defaults";

export const DEFAULT_SETTINGS: AppSettings = {
  targetLanguage: TARGET_LANGUAGES[0],
  rolePrompt: DEFAULT_ROLE_PROMPT,
  researchContext: DEFAULT_RESEARCH_CONTEXT,
  scholarQueries: ["proactive behavior service brand building", "consumer company identification"],
  categories: DEFAULT_CATEGORIES,
  autoHighlight: true,
  colorScheme: "basic",
  journals: DEFAULT_JOURNALS,
  onlyWhitelist: true,
  modelTranslate: "",
  modelChat: "",
  autoTranslate: true,
  theme: "system",
  concurrency: 3,
};

export async function getSettings(): Promise<AppSettings> {
  const rec = await db.settings.get("app");
  return { ...DEFAULT_SETTINGS, ...(rec?.value ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>) {
  const cur = await getSettings();
  await db.settings.put({ key: "app", value: { ...cur, ...patch }, updatedAt: Date.now() });
}

export function useSettings(): AppSettings {
  const rec = useLiveQuery(() => db.settings.get("app"), []);
  return { ...DEFAULT_SETTINGS, ...(rec?.value ?? {}) };
}
