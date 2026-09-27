// Minimal in-memory stand-in for the Supabase APIs Paper Sunshine uses
// (auth password flow, PostgREST ps_records + ps_push RPC, storage objects).
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const users = new Map(); // email -> {id, email, password}
const tokens = new Map(); // access/refresh token -> user
const records = new Map(); // `${uid}|${tbl}|${id}` -> row
const files = new Map(); // `${bucket}/${path}` -> {bytes, type, size}
const log = [];
let lastRev = 0;
const nextRev = () => (lastRev = Math.max(Date.now(), lastRev + 1));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function session(u) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 3600, session_id: randomUUID() })}.sig`;
  const refresh = randomUUID();
  tokens.set(access, u);
  tokens.set(refresh, u);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: refresh, user: userJson(u) };
}
const userJson = (u) => ({ id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email" }, user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() });

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD",
  "access-control-expose-headers": "*",
};
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(status, { ...cors, ...(isBuf ? {} : { "content-type": "application/json" }), ...headers });
  res.end(isBuf ? body : body === undefined ? "" : JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
function authUser(req) {
  const h = req.headers.authorization ?? "";
  return tokens.get(h.replace(/^Bearer\s+/i, "")) ?? null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (req.method === "OPTIONS") return send(res, 204);
  const raw = await readBody(req);
  log.push(`${req.method} ${p}`);
  try {
    // ---------------------------------------------------------------- auth
    if (p === "/auth/v1/signup" && req.method === "POST") {
      const { email, password } = JSON.parse(raw);
      if (users.has(email)) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
      const u = { id: randomUUID(), email, password };
      users.set(email, u);
      return send(res, 200, session(u));
    }
    if (p === "/auth/v1/token" && req.method === "POST") {
      const body = JSON.parse(raw);
      if (url.searchParams.get("grant_type") === "password") {
        const u = users.get(body.email);
        if (!u || u.password !== body.password) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        return send(res, 200, session(u));
      }
      const u = tokens.get(body.refresh_token);
      if (!u) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return send(res, 200, session(u));
    }
    if (p === "/auth/v1/user") {
      const u = authUser(req);
      return u ? send(res, 200, userJson(u)) : send(res, 401, { code: 401, msg: "invalid JWT" });
    }
    if (p === "/auth/v1/logout") return send(res, 204);
    if (p === "/auth/v1/health") return send(res, 200, { name: "GoTrue", version: "fake" });

    // ---------------------------------------------------------------- rest
    if (p.startsWith("/rest/v1/")) {
      const u = authUser(req);
      if (!u) return send(res, 401, { code: "PGRST301", message: "JWT required" });
      if (p === "/rest/v1/rpc/ps_push") {
        const { rows } = JSON.parse(raw);
        let n = 0;
        for (const r of rows) {
          const k = `${u.id}|${r.tbl}|${r.id}`;
          const cur = records.get(k);
          if (cur && cur.updated_at > r.updated_at) continue;
          records.set(k, { user_id: u.id, tbl: r.tbl, id: r.id, paper_id: r.paper_id ?? null, data: r.data, deleted: !!r.deleted, updated_at: r.updated_at, rev: nextRev() });
          n++;
        }
        return send(res, 200, n);
      }
      if (p === "/rest/v1/ps_records") {
        const mine = [...records.values()].filter((r) => r.user_id === u.id);
        const filt = (rows) => {
          let out = rows;
          for (const [k, v] of url.searchParams) {
            if (["select", "order", "limit", "offset"].includes(k)) continue;
            const [op, ...rest] = v.split(".");
            const val = rest.join(".");
            out = out.filter((r) => {
              const x = r[k];
              if (op === "gt") return Number(x) > Number(val);
              if (op === "eq") return String(x) === val;
              if (op === "neq") return String(x) !== val;
              return true;
            });
          }
          return out;
        };
        if (req.method === "HEAD" || (req.method === "GET" && (req.headers.prefer ?? "").includes("count="))) {
          const n = filt(mine).length;
          return send(res, req.method === "HEAD" ? 200 : 200, req.method === "HEAD" ? undefined : [], { "content-range": `0-${Math.max(0, n - 1)}/${n}` });
        }
        if (req.method === "GET") {
          let rows = filt(mine).sort((a, b) => a.rev - b.rev);
          const limit = Number(url.searchParams.get("limit") ?? 1000);
          rows = rows.slice(0, limit);
          return send(res, 200, rows);
        }
        if (req.method === "DELETE") {
          for (const r of filt(mine)) records.delete(`${u.id}|${r.tbl}|${r.id}`);
          return send(res, 204);
        }
      }
      return send(res, 404, { code: "PGRST205", message: `unknown ${p}` });
    }

    // ------------------------------------------------------------- storage
    if (p.startsWith("/storage/v1/object")) {
      const u = authUser(req);
      if (!u) return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "no auth" });
      const rest = p.slice("/storage/v1/object/".length);
      if (rest.startsWith("list/")) {
        const bucket = rest.slice(5);
        const { prefix = "" } = JSON.parse(raw || "{}");
        const pre = `${bucket}/${prefix.replace(/\/$/, "")}/`;
        const out = [...files.entries()].filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes("/")).map(([k, f]) => ({ name: k.slice(pre.length), id: k, metadata: { size: f.size, mimetype: f.type } }));
        return send(res, 200, out);
      }
      if (req.method === "DELETE") {
        const { prefixes = [] } = JSON.parse(raw || "{}");
        const bucket = rest;
        const out = [];
        for (const x of prefixes) if (files.delete(`${bucket}/${x}`)) out.push({ name: x });
        return send(res, 200, out);
      }
      const [bucket, ...pathParts] = rest.split("/");
      const path = decodeURIComponent(pathParts.join("/"));
      if (path.split("/")[0] !== u.id) return send(res, 400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
      const key = `${bucket}/${path}`;
      if (req.method === "POST" || req.method === "PUT") {
        const ct = req.headers["content-type"] ?? "";
        let bytes = raw;
        let type = ct;
        if (ct.startsWith("multipart/form-data")) {
          const fd = await new Request("http://x", { method: "POST", headers: { "content-type": ct }, body: raw }).formData();
          for (const [, v] of fd) if (typeof v !== "string") {
            bytes = Buffer.from(await v.arrayBuffer());
            type = v.type || "application/octet-stream";
          }
        }
        if (files.has(key) && req.headers["x-upsert"] !== "true") return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
        files.set(key, { bytes, type, size: bytes.length });
        return send(res, 200, { Id: randomUUID(), Key: key });
      }
      if (req.method === "GET") {
        const f = files.get(key);
        if (!f) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
        return send(res, 200, f.bytes, { "content-type": f.type || "application/octet-stream" });
      }
    }
    if (p === "/__debug") return send(res, 200, { users: users.size, records: [...records.values()].map((r) => `${r.tbl}:${r.id}${r.deleted ? " (deleted)" : ""}`), files: [...files.keys()], log: log.slice(-40) });
    return send(res, 404, { message: `unknown ${req.method} ${p}` });
  } catch (e) {
    return send(res, 500, { message: String(e) });
  }
}).listen(54321, () => console.log("fake supabase on :54321"));
