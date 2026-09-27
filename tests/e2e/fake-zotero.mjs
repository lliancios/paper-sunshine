// Minimal in-memory Zotero Web API v3 for tests (keys, collections, items, children, files, notes).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT || 54322);
const KEY = "TESTKEY1234567890abcd";
const USER = "4242";
const pdf = (f) => readFileSync(new URL(`../fixtures/${f}`, import.meta.url));
const files = { ATTPDF01: pdf("two-column.pdf"), ATTPDF02: pdf(process.env.PDF2 || "zh-note.pdf") };
const collections = [
  { key: "COLHOARD", version: 1, data: { key: "COLHOARD", name: "Hoarded", parentCollection: false }, meta: { numItems: 3 } },
  { key: "COLSUB01", version: 1, data: { key: "COLSUB01", name: "Sub", parentCollection: "COLHOARD" }, meta: { numItems: 0 } },
];
const item = (key, title, extra, numChildren) => ({ key, version: 1, meta: { numChildren }, data: { key, itemType: "journalArticle", title, creators: [{ creatorType: "author", firstName: "Sabine", lastName: "Sonnentag" }], date: "2003", publicationTitle: "Journal of Applied Psychology", ...extra } });
const items = [
  item("ITEMPDF1", "Recovery, Work Engagement, and Proactive Behavior", { DOI: "10.1037/0021-9010.88.3.518", volume: "88", pages: "518-528" }, 1),
  item("ITEMPDF2", "A Chinese note", {}, 1),
  item("ITEMNOPD", "Only metadata here", { DOI: "10.1000/test.nopdf" }, 0),
];
const children = {
  ITEMPDF1: [{ key: "ATTPDF01", data: { itemType: "attachment", contentType: "application/pdf", linkMode: "imported_file" } }],
  ITEMPDF2: [{ key: "ATTPDF02", data: { itemType: "attachment", contentType: "application/pdf", linkMode: "imported_url" } }],
};
const notes = [];
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "*" };
const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...cors, ...headers });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (req.method === "OPTIONS") return json(res, 204, "");
  if (p.startsWith("/files/")) {
    const b = files[p.slice(7)];
    res.writeHead(b ? 200 : 404, { "content-type": "application/pdf", ...cors });
    return res.end(b ?? "");
  }
  if (p === "/__notes") return json(res, 200, notes);
  if (req.headers["zotero-api-key"] !== KEY) return json(res, 403, "Forbidden");
  let body = "";
  for await (const c of req) body += c;
  if (p === "/keys/current") return json(res, 200, { key: KEY, userID: Number(USER), username: "liang", access: { user: { library: true, files: true, notes: true, write: true } } });
  const base = `/users/${USER}`;
  const page = (arr) => {
    const start = Number(url.searchParams.get("start") || 0);
    const limit = Number(url.searchParams.get("limit") || 25);
    return [arr.slice(start, start + limit), { "total-results": String(arr.length) }];
  };
  if (p === `${base}/collections`) return json(res, 200, ...page(collections));
  if (p === `${base}/collections/COLHOARD/items/top` || p === `${base}/items/top`) return json(res, 200, ...page(items));
  if (p === `${base}/collections/COLSUB01/items/top`) return json(res, 200, ...page([]));
  let m = /^\/users\/\d+\/items\/([A-Z0-9]{8})\/children$/.exec(p);
  if (m) return json(res, 200, children[m[1]] ?? []);
  m = /^\/users\/\d+\/items\/([A-Z0-9]{8})\/file$/.exec(p);
  if (m) {
    res.writeHead(302, { location: `http://localhost:${PORT}/files/${m[1]}`, ...cors });
    return res.end();
  }
  if (p === `${base}/items` && req.method === "POST") {
    const [note] = JSON.parse(body);
    const key = `NOTE${String(notes.length + 1).padStart(4, "0")}`;
    notes.push({ key, version: 1, ...note });
    return json(res, 200, { successful: { 0: { key, version: 1, data: note } }, failed: {} }, { "last-modified-version": "1" });
  }
  m = /^\/users\/\d+\/items\/(NOTE\d{4})$/.exec(p);
  if (m && req.method === "PATCH") {
    const n = notes.find((x) => x.key === m[1]);
    if (!n) return json(res, 404, "Not found");
    if (String(n.version) !== req.headers["if-unmodified-since-version"]) return json(res, 412, "Precondition failed");
    Object.assign(n, JSON.parse(body));
    n.version += 1;
    res.writeHead(204, { "last-modified-version": String(n.version), ...cors });
    return res.end();
  }
  return json(res, 404, `unknown ${req.method} ${p}`);
}).listen(PORT, () => console.log(`fake zotero on :${PORT}`));
