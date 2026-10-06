import crypto from "node:crypto";
import { env } from "../config/env.js";
import { findAdminById } from "../repositories/adminRepo.js";

/**
 * SINGLE-DEVICE ADMIN ACCESS POLICY (spec section 14)
 * ───────────────────────────────────────────────────────────────────────
 * Chosen approach: "Terminate the previous session and allow the new
 * login." Every successful login overwrites the one session kept in
 * memory, which immediately invalidates whatever token was issued before
 * it — the previously-logged-in device gets a 401 (SESSION_SUPERSEDED) on
 * its next request and should redirect to login with an explanatory
 * message.
 *
 * This was chosen over "reject the new login" because a rejected login
 * with no way to recover (lost access to the old device, a stale tab left
 * open) would lock the sole admin account out entirely — a worse failure
 * mode for a one-admin system.
 *
 * Only one admin account will ever exist (no registration path anywhere),
 * so the active session is tracked as a single in-memory value rather
 * than a map keyed by admin id. Sessions are intentionally NOT persisted
 * to MySQL — they're transient by nature, and keeping them in-process
 * keeps "single device" enforcement simple and immediate.
 */
let currentSession = null; // { adminId, token, createdAt, expiresAt }

export function createSession(adminId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  currentSession = {
    adminId,
    token,
    createdAt: now,
    expiresAt: now + env.sessionTtlHours * 60 * 60 * 1000,
  };
  return token;
}

export function destroySession() {
  currentSession = null;
}

export async function requireAuth(req, res, next) {
  // The SAA Staff Portal reuses the admin routers under /api/staff. Its own
  // gate (middleware/staffAuth.js) has already authenticated a staff account
  // and set this flag — it is set server-side only, never from the request.
  if (req.staffContext) return next();

  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in required." });
  }

  if (!currentSession) {
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in required." });
  }

  if (Date.now() > currentSession.expiresAt) {
    destroySession();
    return res.status(401).json({ error: "SESSION_EXPIRED", message: "Your session has expired. Please sign in again." });
  }

  if (currentSession.token !== token) {
    return res.status(401).json({
      error: "SESSION_SUPERSEDED",
      message: "This account was signed in from another device. Only one active session is allowed at a time.",
    });
  }

  const admin = await findAdminById(currentSession.adminId);
  if (!admin) {
    destroySession();
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Sign in required." });
  }

  req.admin = admin;
  next();
}
