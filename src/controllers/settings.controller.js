import bcrypt from "bcryptjs";
import * as settingsRepo from "../repositories/settingsRepo.js";
import * as adminRepo from "../repositories/adminRepo.js";
import { env } from "../config/env.js";
import { getFile } from "../repositories/uploadedFileRepo.js";

export async function getSettings(req, res) {
  const settings = await settingsRepo.getAllSettings();
  res.json({
    admin: { id: req.admin.id, username: req.admin.username, displayName: req.admin.display_name, avatarFileId: req.admin.avatar_file_id || null },
    settings,
    schema: settingsRepo.SETTINGS_SCHEMA,
    email: { enabled: env.email.enabled, from: env.email.from },
  });
}

export async function updateSettings(req, res) {
  const settings = await settingsRepo.updateSettings(req.body || {});
  res.json({ settings });
}

export async function updateProfile(req, res) {
  const displayName = (req.body?.displayName || "").trim();
  const username = (req.body?.username || "").trim().toLowerCase();
  if (!displayName || !username) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Name and username/email are both required." });
  }
  await adminRepo.updateAdminProfile(req.admin.id, { displayName, username });
  const admin = await adminRepo.findAdminById(req.admin.id);
  res.json({ admin: { id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role, avatarFileId: admin.avatar_file_id || null } });
}

// The SAA office logo. It is shown beside every post the admin makes on the
// Campus Feed (in the admin panel and in every portal). Send fileId: null to
// remove it — posts then fall back to the SAA seal.
export async function updateLogo(req, res) {
  const raw = req.body?.fileId;
  const fileId = raw == null || raw === "" ? null : Number(raw);
  if (fileId !== null) {
    const file = Number.isInteger(fileId) ? await getFile(fileId) : null;
    if (!file) return res.status(400).json({ error: "VALIDATION_ERROR", message: "That image could not be found. Please upload it again." });
    if (!String(file.mime_type || "").toLowerCase().startsWith("image/")) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Please choose an image file (JPG, PNG, WEBP, GIF)." });
    }
  }
  await adminRepo.updateAdminAvatar(req.admin.id, fileId);
  const admin = await adminRepo.findAdminById(req.admin.id);
  res.json({ admin: { id: admin.id, username: admin.username, displayName: admin.display_name, role: admin.role, avatarFileId: admin.avatar_file_id || null } });
}

export async function updatePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Current and new password are both required." });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "New password must be at least 8 characters." });
  }
  const currentHash = await adminRepo.getPasswordHash(req.admin.id);
  const matches = currentHash ? await bcrypt.compare(currentPassword, currentHash) : false;
  if (!matches) {
    return res.status(401).json({ error: "INVALID_CREDENTIALS", message: "Current password is incorrect." });
  }
  const nextHash = await bcrypt.hash(newPassword, 10);
  await adminRepo.updateAdminPassword(req.admin.id, nextHash);
  res.json({ message: "Password updated." });
}
