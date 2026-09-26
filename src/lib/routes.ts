/**
 * The reader lives at a single static route (/read?id=…) so the installed app
 * can open any paper offline from one cached page shell.
 */
export const readHref = (id: string) => `/read?id=${encodeURIComponent(id)}`;

/** Paper id from the current URL: /read?id=… or the legacy /read/<id>. */
export function readIdFromLocation(search: string | null, pathname: string): string | null {
  if (search) return search;
  const m = /^\/read\/([^/?#]+)/.exec(pathname);
  return m ? decodeURIComponent(m[1]) : null;
}
