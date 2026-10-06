import bcrypt from "bcryptjs";
import { findAdminByUsername } from "../repositories/adminRepo.js";
import { createSession, destroySession } from "../middleware/auth.js";

export async function login(req, res) {
  const username = (req.body?.username || "").trim().toLowerCase();
  const password = req.body?.password || "";

  if (!username || !password) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Username and password are both required." });
  }

  const admin = await findAdminByUsername(username);

  // Constant-shaped response for both "unknown username" and "wrong
  // password" so the login form never leaks which one was incorrect.
  const passwordMatches = admin ? await bcrypt.compare(password, admin.password_hash) : false;

  if (!admin || !passwordMatches) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Incorrect username or password." });
  }

  const token = createSession(admin.id);

  return res.status(200).json({
    token,
    admin: { id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role, avatarFileId: admin.avatar_file_id || null },
  });
}

export function me(req, res) {
  const { admin } = req; // set by requireAuth
  return res.status(200).json({
    admin: { id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role, avatarFileId: admin.avatar_file_id || null },
  });
}

export function logout(req, res) {
  destroySession();
  return res.status(200).json({ message: "Signed out." });
}
