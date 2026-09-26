import type { HealthResponse } from "@/lib/apiTypes";
import { isAuthorized } from "@/lib/server/auth";
import { hasGemini } from "@/lib/server/gemini";
import { DEFAULT_CHAT_MODEL, DEFAULT_TRANSLATE_MODEL, availableProviders } from "@/lib/server/llm";
import { hasOpenAlex } from "@/lib/server/openalex";
import { APP_VERSION } from "@/lib/version";

export async function GET(req: Request) {
  const body: HealthResponse = {
    ok: true,
    passcodeRequired: !!process.env.APP_PASSCODE,
    authorized: isAuthorized(req),
    gemini: hasGemini(),
    openalex: hasOpenAlex(),
    providers: availableProviders(),
    models: { translate: DEFAULT_TRANSLATE_MODEL, chat: DEFAULT_CHAT_MODEL },
    version: APP_VERSION,
  };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
