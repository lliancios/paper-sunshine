import type { HealthResponse } from "@/lib/apiTypes";
import { isAuthorized } from "@/lib/server/auth";
import { hasGemini, modelFor } from "@/lib/server/gemini";
import { hasOpenAlex } from "@/lib/server/openalex";
import { APP_VERSION } from "@/lib/version";

export async function GET(req: Request) {
  const body: HealthResponse = {
    ok: true,
    passcodeRequired: !!process.env.APP_PASSCODE,
    authorized: isAuthorized(req),
    gemini: hasGemini(),
    openalex: hasOpenAlex(),
    models: { translate: modelFor("translate"), chat: modelFor("chat") },
    version: APP_VERSION,
  };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
