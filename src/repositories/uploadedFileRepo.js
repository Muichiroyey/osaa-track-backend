import { pool } from "../config/db.js";

// uploadedByUserId is set for portal accounts (student/alumni/office) and
// left NULL for the admin; see canPortalUserAccessFile for what it unlocks.
export async function createFile({ originalName, storedName, mimeType, sizeBytes, uploadedByUserId = null }) {
  const [result] = await pool.query(
    "INSERT INTO uploaded_files (original_name, stored_name, mime_type, size_bytes, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?)",
    [originalName, storedName, mimeType || null, sizeBytes || null, uploadedByUserId]
  );
  return result.insertId;
}

export async function getFile(id) {
  const [rows] = await pool.query("SELECT * FROM uploaded_files WHERE id = ?", [id]);
  return rows[0] || null;
}

export async function getFiles(ids) {
  if (!ids || ids.length === 0) return [];
  const [rows] = await pool.query(
    `SELECT * FROM uploaded_files WHERE id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  return rows;
}
