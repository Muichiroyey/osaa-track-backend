/**
 * REALTIME — "reflect instantly"
 * ───────────────────────────────────────────────────────────────────────
 * Every open Admin Panel and Student/Alumni Portal keeps ONE lightweight
 * Server-Sent-Events connection to the backend. Whenever anything is
 * created, edited or deleted (in either app), the backend pushes a tiny
 * "these topics changed" message down every connection, and each open page
 * that shows one of those topics quietly re-fetches its own data. So a
 * change made in one place appears everywhere else within a fraction of a
 * second — no reload, no waiting for a polling timer.
 *
 * The message carries only topic NAMES (e.g. "announcements"), never any
 * data, so nothing private travels over it: each page still re-fetches
 * through its normal, permission-checked API call.
 *
 * Why SSE and not WebSockets: it is plain HTTP (works through the Vite dev
 * proxy, Railway and any reverse proxy with no extra package or setup),
 * one-directional is all this needs, and browsers/clients reconnect on
 * their own. State lives in this one Node process, which matches how the
 * app already keeps its sessions.
 */

const HEARTBEAT_MS = 20_000;

// { res, scope: 'admin' | 'portal', userId?: number }
const clients = new Set();

function write(client, chunk) {
  try {
    client.res.write(chunk);
  } catch {
    clients.delete(client);
  }
}

/** Opens the event stream on an Express response. */
export function openStream(req, res, { scope, userId = null }) {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    // Tells nginx-style proxies (Railway, etc.) not to buffer the stream.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  const client = { res, scope, userId };
  clients.add(client);
  // Retry hint + an immediate first event so the browser knows it's live.
  write(client, `retry: 3000\n`);
  write(client, `event: hello\ndata: ${JSON.stringify({ at: Date.now(), scope })}\n\n`);

  const timer = setInterval(() => write(client, `: ping ${Date.now()}\n\n`), HEARTBEAT_MS);
  const cleanup = () => {
    clearInterval(timer);
    clients.delete(client);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}

/**
 * Tells connected sessions that some topics changed.
 * audience: 'all' (everyone), or { adminOnly: true, portalUserId } — used
 * for a portal user's own actions, which only the admin and that same user's
 * other tabs need to hear about, not every other student online.
 */
export function broadcast(topics, audience = "all") {
  const list = [...new Set(topics)].filter(Boolean);
  if (list.length === 0 || clients.size === 0) return 0;
  const payload = `event: change\ndata: ${JSON.stringify({ topics: list, at: Date.now() })}\n\n`;
  let sent = 0;
  for (const client of clients) {
    if (audience !== "all") {
      if (client.scope === "portal" && client.userId !== audience.portalUserId) continue;
    }
    write(client, payload);
    sent += 1;
  }
  return sent;
}

export function connectedCount() {
  return clients.size;
}

/* ─────────────────────────────────────────────────────────────────────
 * Which topics does a write to this URL change?
 * A topic is simply the module's API name. Pages subscribe to the topics
 * their data comes from; 'summary' (dashboard + sidebar counts) and
 * 'analytics' are affected by nearly everything, so they ride along.
 * ───────────────────────────────────────────────────────────────────── */

const ADMIN_MODULES = new Set([
  "announcements",
  "document-repository",
  "document-queue",
  "scholarships",
  "achievements",
  "campus-feed",
  "student-endorsement",
  "job-postings",
  "alumni-profiles",
  "user-management",
  "faq",
  "student-leaders",
  "reports",
  "settings",
  "chat",
  "offices",
]);

// A change to one module that other modules' screens also draw from.
const ALSO_AFFECTS = {
  "user-management": ["offices", "alumni-profiles", "chat", "document-queue"],
  offices: ["document-queue", "document-repository", "student-endorsement"],
  settings: ["document-queue", "campus-feed"], // the admin's logo sits on Campus Feed posts
  "student-leaders": ["reports"],
};

// Portal (student/alumni) writes, mapped onto the admin-side modules they change.
const PORTAL_TOPICS = [
  [/^\/document-queue/, ["document-queue"]],
  [/^\/chat/, ["chat"]],
  [/^\/scholarships/, ["scholarships"]],
  [/^\/achievements/, ["achievements"]],
  [/^\/profile/, ["alumni-profiles"]],
  [/^\/auth\/(profile|password)/, ["user-management"]],
];

// Office Portal writes. `broad: true` means the write can affect another
// office's own screen too (an e-signature request landing in their inbox,
// an endorsement addressed to them, an inter-office transmission, or the
// public Campus Feed) — those broadcast to everyone, same as the admin's
// own actions, rather than just admin + this office's own tabs.
const OFFICE_TOPICS = [
  [/^\/document-queue/, ["document-queue"], true],
  [/^\/campus-feed/, ["campus-feed"], true],
  [/^\/endorsements/, ["student-endorsement"], true],
  [/^\/document-repository/, ["document-repository"], true],
  // Public organization documents now reach students and other offices too, so this is broadcast.
  [/^\/student-leaders/, ["student-leaders"], true],
  [/^\/chat/, ["chat"], false],
  // An office changing its profile can change the logo on its Campus Feed
  // posts, which everyone sees — so that one is broadcast; a password change
  // concerns only that office.
  [/^\/auth\/profile/, ["user-management", "campus-feed"], true],
  [/^\/auth\/password/, ["user-management"], false],
];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * @returns {{ topics: string[], audience: 'all' | object } | null}
 */
export function describeMutation(method, originalUrl, portalUserId = null) {
  if (!WRITE_METHODS.has(method)) return null;
  const path = String(originalUrl || "").split("?")[0];
  if (!path.startsWith("/api/")) return null;

  // Portal write: notify the admin plus the person's own other tabs.
  if (path.startsWith("/api/portal/")) {
    const rest = path.slice("/api/portal".length);
    if (rest.startsWith("/auth/login") || rest.startsWith("/auth/logout")) return null;
    const hit = PORTAL_TOPICS.find(([re]) => re.test(rest));
    if (!hit) return null;
    const topics = hit[1].flatMap((t) => [t, ...(ALSO_AFFECTS[t] || [])]);
    return {
      topics: [...topics, "summary", "analytics"],
      audience: { adminOnly: true, portalUserId },
    };
  }

  if (path.startsWith("/api/office/")) {
    const rest = path.slice("/api/office".length);
    if (rest.startsWith("/auth/login") || rest.startsWith("/auth/logout")) return null;
    const hit = OFFICE_TOPICS.find(([re]) => re.test(rest));
    if (!hit) return null;
    const [, mods, broad] = hit;
    if (mods.length === 0) return null;
    const topics = mods.flatMap((t) => [t, ...(ALSO_AFFECTS[t] || [])]);
    return {
      topics: [...topics, "summary", "analytics"],
      audience: broad ? "all" : { adminOnly: true, portalUserId },
    };
  }

  // SAA Staff writes are the admin's own modules reached via /api/staff, so
  // they refresh everyone exactly like an admin write does.
  let module = path.split("/")[2]; // /api/<module>/...
  if (module === "staff") {
    const staffPath = path.slice("/api/staff".length);
    if (staffPath.startsWith("/auth/login") || staffPath.startsWith("/auth/logout")) return null;
    if (staffPath.startsWith("/settings") || staffPath.startsWith("/auth/")) return { topics: ["user-management", "summary"], audience: "all" };
    module = path.split("/")[3]; // /api/staff/<module>/...
  }
  if (!ADMIN_MODULES.has(module)) return null;
  const topics = [module, ...(ALSO_AFFECTS[module] || []), "summary", "analytics"];
  return { topics, audience: "all" };
}

/**
 * Express middleware: after any successful write, tell everyone. Mounted once
 * in app.js, so no controller has to remember to call anything — new
 * endpoints under an existing module are covered automatically.
 */
export function notifyOnWrite(req, res, next) {
  if (!WRITE_METHODS.has(req.method)) return next();
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const described = describeMutation(req.method, req.originalUrl, req.portalUser?.id ?? null);
    if (described) broadcast(described.topics, described.audience);
  });
  next();
}
