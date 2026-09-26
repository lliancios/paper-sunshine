import type { HealthResponse } from "@/lib/apiTypes";
import { isAuthorized } from "@/lib/server/auth";
import { hasGemini } from "@/lib/server/gemini";
import { DEFAULT_CHAT_MODEL, DEFAULT_TRANSLATE_MODEL, availableProviders } from "@/lib/server/llm";
import { hasOpenAlex } from "@/lib/server/openalex";
import { APP_VERSION } from "@/lib/version";

// The anon/publishable key is designed to be public (row level security does
// the protecting); it is still only handed to clients that know the passcode.
function syncConfig() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

export async function GET(req: Request) {
  const authorized = isAuthorized(req);
  const body: HealthResponse = {
    ok: true,
    passcodeRequired: !!process.env.APP_PASSCODE,
    authorized,
    gemini: hasGemini(),
    openalex: hasOpenAlex(),
    providers: availableProviders(),
    models: { translate: DEFAULT_TRANSLATE_MODEL, chat: DEFAULT_CHAT_MODEL },
    version: APP_VERSION,
    build: process.env.NEXT_PUBLIC_BUILD_ID ?? "",
    sync: authorized ? syncConfig() : null,
  };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
