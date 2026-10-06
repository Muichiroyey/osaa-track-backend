import { comparePassword } from "../services/passwordWorker.js";
import * as repo from "../repositories/portalRepo.js";
import { createPortalSession, destroyPortalSession, destroySessionsForUser } from "../middleware/portalAuth.js";
import { checkAttachableFiles } from "../services/fileOwnership.js";

// Only these two types have a portal. Staff and Offices accounts exist in
// the same users table and are real login accounts, but their panels don't
// exist yet — signing in with one has to fail clearly rather than dumping
// them into a student dashboard.
const PORTAL_TYPES = new Set(["student", "alumni"]);

function publicUser(user) {
  return {
    id: user.id,
    code: user.code,
    name: user.name,
    email: user.email,
    type: user.type,
    department: user.department,
    status: user.status,
    isDemo: Boolean(user.is_demo),
    avatarFileId: user.avatar_file_id || null,
    // Drives the "you're still using the password the SAA office gave you"
    // prompt in Settings — see updatePassword below.
    usingIssuedPassword: !user.password_changed_at,
    lastLoginAt: user.last_login_at || null,
  };
}

/**
 * ONE SIGN-IN PAGE, TWO DOORS.
 * Students and alumni use the same page, but the person picks which one
 * they are ("accountType") and the server holds them to it: an account
 * whose `users.type` is student can only sign in through the Student
 * option, and an alumni account only through Alumni. Picking the wrong
 * one is refused here — no session is created — so a student can never
 * end up inside the alumni dashboard (or the other way round).
 * There is no sign-up anywhere — the admin creates every account in User
 * Management and sets its first password.
 */
export async function login(req, res) {
  const email = (req.body?.email || req.body?.username || "").trim().toLowerCase();
  const password = req.body?.password || "";
  const accountType = String(req.body?.accountType || "").trim().toLowerCase();

  if (!email || !password) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Email address and password are both required." });
  }
  if (!PORTAL_TYPES.has(accountType)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Choose whether you are signing in as a Student or as an Alumni." });
  }

  const user = await repo.findPortalUserByEmail(email);

  // Same constant-shaped answer for "no such email", "no password set yet",
  // and "wrong password", so the form can't be used to find out which
  // email addresses exist.
  const passwordMatches = user?.password_hash ? await comparePassword(password, user.password_hash) : false;
  if (!user || !passwordMatches) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Incorrect email or password." });
  }

  if (!PORTAL_TYPES.has(user.type)) {
    return res.status(403).json({
      error: "WRONG_ACCOUNT_TYPE",
      message: "This portal is for student and alumni accounts only. Administrator and office accounts sign in elsewhere.",
    });
  }

  // The account type the person picked on the sign-in page has to be the
  // account's real type. This is checked only AFTER the password has been
  // verified, so telling them which type the account is can't be used to
  // discover which email addresses exist.
  if (user.type !== accountType) {
    return res.status(403).json({
      error: "WRONG_ACCOUNT_TYPE",
      message: `This is ${user.type === "alumni" ? "an Alumni" : "a Student"} account, so it can't sign in as ${
        accountType === "alumni" ? "Alumni" : "Student"
      }. Select \u201c${user.type === "alumni" ? "Alumni" : "Student"}\u201d above and try again.`,
    });
  }

  // "Inactive accounts cannot sign in" (Student features, step 5). A
  // pending account hasn't been verified by the SAA office yet, so it gets
  // its own message rather than looking like a wrong password.
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

  return res.status(200).json({ token, user: publicUser({ ...user, last_login_at: user.last_login_at }) });
}

export async function me(req, res) {
  res.json({ user: publicUser(req.portalUser) });
}

export function logout(req, res) {
  destroyPortalSession(req.portalToken);
  res.json({ message: "Signed out." });
}

export async function updateProfile(req, res) {
  const name = (req.body?.name || "").trim();
  if (!name) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Your name can't be empty." });
  }
  // A new picture has to be a file this person uploaded themselves (it
  // becomes visible to others — e.g. an office's logo on its Campus Feed
  // posts), and has to be an image. Sending the picture they already have
  // is always fine; `removeAvatar: true` clears it.
  const current = req.portalUser.avatar_file_id ?? null;
  let avatarFileId = req.body?.avatarFileId ?? current;
  if (req.body?.removeAvatar === true) avatarFileId = null;
  if (avatarFileId != null && Number(avatarFileId) !== Number(current)) {
    const problem = await checkAttachableFiles([avatarFileId], req.portalUser.id, { imagesOnly: true });
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
  }
  await repo.updateOwnProfile(req.portalUser.id, { name, avatarFileId });
  const user = await repo.findPortalUserById(req.portalUser.id);
  res.json({ user: publicUser(user) });
}

/**
 * The admin sets the first password; this is how a user replaces it with
 * one of their own. Current password is required as identity
 * verification, and the session deliberately survives the change — the
 * spec is explicit that the user "will stay securely logged in on your
 * current device". Any OTHER session this account has open is dropped,
 * which is the point of changing a password you suspect someone else has.
 */
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

  const hash = await repo.getPasswordHash(req.portalUser.id);
  const matches = hash ? await comparePassword(currentPassword, hash) : false;
  if (!matches) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Current password is incorrect." });
  }

  await repo.updateOwnPassword(req.portalUser.id, newPassword);

  // Drop every session for this account, then hand this device a fresh
  // token so it stays signed in and everything else has to sign in again.
  destroySessionsForUser(req.portalUser.id);
  const token = createPortalSession(req.portalUser.id);
  const user = await repo.findPortalUserById(req.portalUser.id);

  res.json({ message: "Password updated.", token, user: publicUser(user) });
}
