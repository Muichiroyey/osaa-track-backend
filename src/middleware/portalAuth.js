import crypto from "node:crypto";
import { env } from "../config/env.js";
import { findPortalUserById } from "../repositories/portalRepo.js";
import { requireAuth } from "./auth.js";

/**
 * PORTAL SESSIONS (student / alumni)
 * ───────────────────────────────────────────────────────────────────────
 * Deliberately NOT the same store as the admin's session in auth.js.
 *
 * The admin session is a single in-memory value because exactly one admin
 * account exists and single-device enforcement is a stated requirement for
 * it (see the comment above createSession() there). The portal is the
 * opposite case: many people are signed in at once, so sessions live in a
 * Map keyed by token. Reusing the admin's single-value store would mean a
 * student signing in silently kicks the admin out — the two have to be
 * separate stores even though they share this one backend.
 *
 * Unlike the admin, a portal user is NOT limited to one device: a student
 * checking a ticket on their phone shouldn't sign themselves out of the
 * laptop they left open in the library. Nothing in the spec asks for
 * single-device here, and the failure mode of enforcing it is worse than
 * the risk it removes.
 *
 * Like the admin's, these are in-process and intentionally not persisted
 * to MySQL — restarting the backend signs everyone out, which is expected
 * in development.
 *
 * MANY PEOPLE AT ONCE: nothing here limits how many. Each sign-in is its own
 * independent entry in the map, so any number of students and alumni can be
 * signed in together — and the same person can be signed in on several
 * devices or tabs. (What used to make it LOOK single-user on localhost was the
 * browser side: see api/client.js in the portal.)
 */
const sessions = new Map(); // token -> { userId, createdAt, expiresAt }

export function createPortalSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  sessions.set(token, {
    userId,
    createdAt: now,
    expiresAt: now + env.sessionTtlHours * 60 * 60 * 1000,
  });
  return token;
}

export function destroyPortalSession(token) {
  sessions.delete(token);
}

// A session is normally removed when it is used after it has expired — but a
// person who simply closes the tab never uses it again. With many people
// signing in every day those would pile up forever, so expired ones are swept
// out regularly. (Never touches a session that is still valid.)
const SWEEP_EVERY_MS = 10 * 60 * 1000;

export function sweepExpiredPortalSessions(now = Date.now()) {
  let removed = 0;
  for (const [token, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(token);
      removed += 1;
    }
  }
  return removed;
}

export function portalSessionCount() {
  return sessions.size;
}

// unref(): this timer alone must never keep the process alive.
setInterval(sweepExpiredPortalSessions, SWEEP_EVERY_MS).unref();

// Every session belonging to one account — used when the admin deactivates
// or deletes a user, so a revoked account can't keep using a token it was
// already holding.
export function destroySessionsForUser(userId) {
  for (const [token, session] of sessions) {
    if (session.userId === userId) sessions.delete(token);
  }
}

function readBearer(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

export async function resolvePortalUser(req) {
  const token = readBearer(req);
  if (!token) return { error: { status: 401, code: "UNAUTHENTICATED", message: "Sign in required." } };

  const session = sessions.get(token);
  if (!session) return { error: { status: 401, code: "UNAUTHENTICATED", message: "Sign in required." } };

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return { error: { status: 401, code: "SESSION_EXPIRED", message: "Your session has expired. Please sign in again." } };
  }

  const user = await findPortalUserById(session.userId);
  if (!user) {
    sessions.delete(token);
    return { error: { status: 401, code: "UNAUTHENTICATED", message: "Sign in required." } };
  }

  // Status is re-checked on every request, not just at login: if the admin
  // deactivates an account mid-session, the next thing that account tries
  // to do stops working rather than continuing until the token expires.
  if (user.status !== "active") {
    sessions.delete(token);
    return {
      error: {
        status: 403,
        code: "ACCOUNT_INACTIVE",
        message: "This account is no longer active. Please contact the SAA office.",
      },
    };
  }

  return { user, token };
}

export async function requirePortalAuth(req, res, next) {
  const { user, token, error } = await resolvePortalUser(req);
  if (error) return res.status(error.status).json({ error: error.code, message: error.message });
  req.portalUser = user;
  req.portalToken = token;
  next();
}

/**
 * Type gate — the whole point of `users.type`. Student and alumni share one
 * login screen and one app, so what a signed-in account may reach is
 * decided here, server-side: a student hitting an alumni-only route gets a
 * 403 even if they type the URL in directly. Hiding the nav link is not
 * the control; this is.
 */
export function requireType(...allowedTypes) {
  return (req, res, next) => {
    if (!req.portalUser) {
      return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in required." });
    }
    if (!allowedTypes.includes(req.portalUser.type)) {
      return res.status(403).json({
        error: "WRONG_ACCOUNT_TYPE",
        message: `This section is for ${allowedTypes.join(" / ")} accounts. You're signed in as ${req.portalUser.type}.`,
      });
    }
    next();
  };
}

/**
 * Accepts either an admin token or a portal token. Used only by the shared
 * upload pipeline (POST /api/uploads and the file view/download endpoints),
 * so both panels keep using the exact same storage path instead of the
 * portal growing a parallel one. Whichever identity matched is left on the
 * request so the file-access check downstream knows who is asking.
 */
export async function requireAnyAuth(req, res, next) {
  // Mounted under /api/staff: the staff gate has already authenticated.
  if (req.staffContext) return next();
  const portal = await resolvePortalUser(req);
  if (portal.user) {
    req.portalUser = portal.user;
    req.portalToken = portal.token;
    return next();
  }
  // Not a valid portal token — fall through to the admin session, which
  // answers with its own error if that fails too.
  return requireAuth(req, res, next);
}
