import { pool } from "../config/db.js";

/**
 * NOTIFICATIONS (Office Portal, spec section 11)
 * ───────────────────────────────────────────────────────────────────────
 * "Notifications are an automated supporting system function. Office
 * staff do not manually create these system notifications." — so the
 * only way a row appears here is a controller calling notify() at the
 * moment of the triggering event (a ticket routed for e-signature, an
 * admin document request, an endorsement received, a revision request,
 * a document status update). There is no create/update/delete route for
 * this table anywhere — only list + mark-read.
 */
export async function notify({ userId, type, title, body, linkType = null, linkId = null }) {
  if (!userId) return null; // office has no linked login account — nothing to notify
  const [result] = await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, link_type, link_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, type, title, body || null, linkType, linkId]
  );
  return result.insertId;
}

export async function listForUser(userId, { unreadOnly = false } = {}) {
  const clauses = ["user_id = ?"];
  const params = [userId];
  if (unreadOnly) clauses.push("is_read = 0");
  const [rows] = await pool.query(
    `SELECT * FROM notifications WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT 100`,
    params
  );
  return rows;
}

export async function countUnread(userId) {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0",
    [userId]
  );
  return Number(rows[0]?.c || 0);
}

export async function markRead(id, userId) {
  const [result] = await pool.query(
    "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
    [id, userId]
  );
  return result.affectedRows > 0;
}

export async function markAllRead(userId) {
  const [result] = await pool.query(
    "UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0",
    [userId]
  );
  return result.affectedRows;
}
