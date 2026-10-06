import { comparePassword } from "../services/passwordWorker.js";
import * as repo from "../repositories/portalRepo.js";
import { createPortalSession, destroyPortalSession, destroySessionsForUser } from "../middleware/portalAuth.js";
import { checkAttachableFiles } from "../services/fileOwnership.js";

/**
 * SAA STAFF LOG-IN
 * ───────────────────────────────────────────────────────────────────────
 * Staff do not sign up. The admin creates every staff account in User
 * Management (Type = Staff) and sets its first password; email is the
 * username. ONLY `users.type = 'staff'` can sign in here — students,
 * alumni and offices are refused (and a staff account is in turn refused by
 * the other portals), and the admin signs in at the Admin Panel.
 *
 * The identity is returned under the key `admin`, shaped exactly like the
 * Admin Panel's, so the staff app's copy of the admin shell (header, greeting,
 * protected routes) works unchanged.
 */
function publicStaff(user) {
  return {
    id: user.id,
    code: user.code,
    username: user.email,
    email: user.email,
    displayName: user.name,
    role: "staff",
    department: user.department || null,
    status: user.status,
    isDemo: Boolean(user.is_demo),
    avatarFileId: user.avatar_file_id || null,
    usingIssuedPassword: !user.password_changed_at,
    lastLoginAt: user.last_login_at || null,
  };
}

export async function login(req, res) {
  const email = (req.body?.email || req.body?.username || "").trim().toLowerCase();
  const password = req.body?.password || "";

  if (!email || !password) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Email address and password are both required." });
  }

  const user = await repo.findPortalUserByEmail(email);

  // One answer for "no such email", "no password yet" and "wrong password".
  const passwordMatches = user?.password_hash ? await comparePassword(password, user.password_hash) : false;
  if (!user || !passwordMatches) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Incorrect email or password." });
  }

  // Only after the password is verified is the account's type revealed, so
  // this message can't be used to discover which emails exist.
  if (user.type !== "staff") {
    return res.status(403).json({
      error: "WRONG_ACCOUNT_TYPE",
      message: "This portal is for SAA Staff accounts only. Students, alumni, offices and the administrator sign in elsewhere.",
    });
  }
  if (user.status === "inactive") {
    return res.status(403).json({ error: "ACCOUNT_INACTIVE", message: "This account has been deactivated. Please contact the SAA Administrator." });
  }
  if (user.status === "pending") {
    return res.status(403).json({ error: "ACCOUNT_PENDING", message: "This account is still awaiting verification by the SAA Administrator." });
  }

  const token = createPortalSession(user.id);
  await repo.touchLastLogin(user.id);

  return res.status(200).json({ token, admin: publicStaff({ ...user, last_login_at: user.last_login_at }) });
}

export function me(req, res) {
  res.json({ admin: publicStaff(req.staffUser) });
}

export function logout(req, res) {
  destroyPortalSession(req.staffToken);
  res.json({ message: "Signed out." });
}

/* ── Settings (spec section 15) ─────────────────────────────────────────── */

export function getSettings(req, res) {
  res.json({ admin: publicStaff(req.staffUser) });
}

// Personal profile: display name. (The email is the login username and is
// issued by the administrator, so it is shown but not editable here.)
export async function updateProfile(req, res) {
  const name = (req.body?.displayName || "").trim();
  if (!name) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Your name can't be empty." });
  if (name.length > 191) return res.status(400).json({ error: "VALIDATION_ERROR", message: "That name is too long." });
  await repo.updateOwnProfile(req.staffUser.id, { name, avatarFileId: req.staffUser.avatar_file_id ?? null });
  const user = await repo.findPortalUserById(req.staffUser.id);
  res.json({ admin: publicStaff(user) });
}

// Profile photo. Send fileId: null to remove it.
export async function updatePhoto(req, res) {
  const raw = req.body?.fileId;
  const fileId = raw == null || raw === "" ? null : Number(raw);
  const current = req.staffUser.avatar_file_id ?? null;
  if (fileId !== null && fileId !== Number(current)) {
    const problem = await checkAttachableFiles([fileId], req.staffUser.id, { imagesOnly: true });
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
  }
  await repo.updateOwnProfile(req.staffUser.id, { name: req.staffUser.name, avatarFileId: fileId });
  const user = await repo.findPortalUserById(req.staffUser.id);
  res.json({ admin: publicStaff(user) });
}

export async function updatePassword(req, res) {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Current and new password are both required." });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "New password must be at least 8 characters." });
  }
  if (confirmPassword !== undefined && confirmPassword !== newPassword) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "New password and confirmation don't match." });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Your new password must be different from your current one." });
  }
  const hash = await repo.getPasswordHash(req.staffUser.id);
  const matches = hash ? await comparePassword(currentPassword, hash) : false;
  if (!matches) return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Current password is incorrect." });

  await repo.updateOwnPassword(req.staffUser.id, newPassword);
  // This device stays signed in; every other session of the account is ended.
  destroySessionsForUser(req.staffUser.id);
  const token = createPortalSession(req.staffUser.id);
  const user = await repo.findPortalUserById(req.staffUser.id);
  res.json({ message: "Password updated.", token, admin: publicStaff(user) });
}
