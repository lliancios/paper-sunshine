import { timingSafeEqual } from "node:crypto";

/** Returns an error Response when the request lacks the app passcode. */
export function requireAuth(req: Request): Response | null {
  const expected = process.env.APP_PASSCODE ?? "";
  if (!expected) return null; // local dev without a passcode
  const got = req.headers.get("x-ps-pass") ?? "";
  if (isValid(got, expected)) return null;
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export function isAuthorized(req: Request): boolean {
  const expected = process.env.APP_PASSCODE ?? "";
  if (!expected) return true;
  return isValid(req.headers.get("x-ps-pass") ?? "", expected);
}

function isValid(got: string, expected: string): boolean {
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
