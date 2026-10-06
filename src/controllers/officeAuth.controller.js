import { comparePassword } from "../services/passwordWorker.js";
import * as repo from "../repositories/portalRepo.js";
import { getOfficeByUserId } from "../repositories/officeRepo.js";
import { createPortalSession, destroySessionsForUser } from "../middleware/portalAuth.js";

async function publicUser(user) {
  const office = await getOfficeByUserId(user.id);
  return {
    id: user.id,
    code: user.code,
    name: user.name,
    email: user.email,
    type: user.type,
    status: user.status,
    isDemo: Boolean(user.is_demo),
    avatarFileId: user.avatar_file_id || null,
    usingIssuedPassword: !user.password_changed_at,
    lastLoginAt: user.last_login_at || null,
    officeId: office?.id || null,
    officeName: office?.name || user.name,
    officeCategory: office?.category || null,
  };
}

/**
 * OFFICE LOG-IN PANEL (spec section "Office Log-In Panel")
 * "Provides instructors and staff with access to the OSAA-TRACK Office
 * Portal using an account provided and pre-registered by the university."
 * No sign-up, no account-type picker — unlike the shared Student/Alumni
 * page, an authorized office's institutional email is unambiguous about
 * which account it is. Every real office already has a `users` row with
 * `type = 'offices'` (seeded from the office credentials the admin was
 * given, one per authorized office); this only accepts that type.
 */
export async function login(req, res) {
  const email = (req.body?.email || req.body?.username || "").trim().toLowerCase();
  const password = req.body?.password || "";

  if (!email || !password) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Institutional email and password are both required." });
  }

  const user = await repo.findPortalUserByEmail(email);

  // Same constant-shaped answer whether the email doesn't exist, has no
  // password set, or the password is simply wrong.
  const passwordMatches = user?.password_hash ? await comparePassword(password, user.password_hash) : false;
  if (!user || !passwordMatches) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Incorrect email or password." });
  }

  if (user.type !== "offices") {
    return res.status(403).json({
      error: "WRONG_ACCOUNT_TYPE",
      message: "This portal is for authorized Office accounts only. Students, alumni, and administrators sign in elsewhere.",
    });
  }

  if (user.status === "inactive") {
    return res.status(403).json({
      error: "ACCOUNT_INACTIVE",
      message: "This account has been deactivated. Please contact the SAA office.",
    });
  }
  if (user.status === "pending") {
    return res.status(403).json({
      error: "ACCOUNT_PENDING",
      message: "This account is still awaiting verification by the SAA office.",
    });
  }

  const token = createPortalSession(user.id);
  await repo.touchLastLogin(user.id);

  return res.status(200).json({ token, user: await publicUser({ ...user, last_login_at: user.last_login_at }) });
}

// me/logout/updateProfile/updatePassword: the same underlying repo calls
// as the Student/Alumni Portal (they only ever touch req.portalUser.id),
// but re-exported here through this file's office-aware publicUser() so a
// page refresh keeps showing which office this session belongs to, not
// just at login.
export async function me(req, res) {
  res.json({ user: await publicUser(req.portalUser) });
}

export { publicUser };
export { logout, updateProfile, updatePassword } from "./portalAuth.controller.js";
