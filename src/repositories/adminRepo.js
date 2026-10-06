import { pool } from "../config/db.js";

export async function findAdminByUsername(username) {
  const [rows] = await pool.query(
    "SELECT id, username, password_hash, display_name, role, avatar_file_id FROM admins WHERE LOWER(username) = LOWER(?) LIMIT 1",
    [username]
  );
  return rows[0] || null;
}

export async function findAdminById(id) {
  const [rows] = await pool.query(
    "SELECT id, username, display_name, role, avatar_file_id FROM admins WHERE id = ? LIMIT 1",
    [id]
  );
  return rows[0] || null;
}

// Only display_name/username are editable from Settings — role stays
// fixed (there's exactly one admin account in this phase, seeded, not
// self-registered).
export async function updateAdminProfile(id, { displayName, username }) {
  const [result] = await pool.query(
    "UPDATE admins SET display_name = ?, username = ? WHERE id = ?",
    [displayName, username, id]
  );
  return result.affectedRows > 0;
}

export async function getPasswordHash(id) {
  const [rows] = await pool.query("SELECT password_hash FROM admins WHERE id = ?", [id]);
  return rows[0]?.password_hash || null;
}

export async function updateAdminPassword(id, passwordHash) {
  const [result] = await pool.query("UPDATE admins SET password_hash = ? WHERE id = ?", [passwordHash, id]);
  return result.affectedRows > 0;
}

// The SAA office logo, set from the admin's Settings page. Shown on the
// admin's Campus Feed posts in every portal. NULL clears it (the posts then
// fall back to the SAA seal).
export async function updateAdminAvatar(id, fileId) {
  const [result] = await pool.query("UPDATE admins SET avatar_file_id = ? WHERE id = ?", [fileId || null, id]);
  return result.affectedRows > 0;
}

// There is exactly one admin account, so "the admin's logo" is simply the
// first (only) row's. Used when attributing an admin-authored post.
export async function getAdminAvatarFileId() {
  const [rows] = await pool.query("SELECT avatar_file_id FROM admins ORDER BY id LIMIT 1");
  return rows[0]?.avatar_file_id || null;
}
