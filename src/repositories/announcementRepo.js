import { pool } from "../config/db.js";
import { getFiles } from "./uploadedFileRepo.js";

function parseRawRow(row) {
  return {
    ...row,
    audience: typeof row.audience === "string" ? JSON.parse(row.audience) : row.audience,
    attachmentIds: (typeof row.attachments === "string" ? JSON.parse(row.attachments) : row.attachments) || [],
  };
}

async function expandAttachments(row) {
  const { attachmentIds, ...rest } = row;
  const files = await getFiles(attachmentIds);
  return { ...rest, attachments: files };
}

export async function listAnnouncements({ status, search } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  if (search) {
    clauses.push("title LIKE ?");
    params.push(`%${search}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT * FROM announcements ${where} ORDER BY (priority = 'urgent') DESC, COALESCE(published_at, created_at) DESC`,
    params
  );
  return Promise.all(rows.map((r) => expandAttachments(parseRawRow(r))));
}

export async function getAnnouncement(id) {
  const [rows] = await pool.query("SELECT * FROM announcements WHERE id = ?", [id]);
  if (!rows[0]) return null;
  return expandAttachments(parseRawRow(rows[0]));
}

export async function createAnnouncement({ title, body, priority, audience, attachmentIds, asDraft }) {
  const status = asDraft ? "draft" : "published";
  const [result] = await pool.query(
    `INSERT INTO announcements (title, body, priority, audience, attachments, status, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ${asDraft ? "NULL" : "NOW()"})`,
    [title, body, priority, JSON.stringify(audience), JSON.stringify(attachmentIds || []), status]
  );
  return result.insertId;
}

export async function updateAnnouncement(id, { title, body, priority, audience, attachmentIds }) {
  const [result] = await pool.query(
    `UPDATE announcements SET title=?, body=?, priority=?, audience=?, attachments=? WHERE id=?`,
    [title, body, priority, JSON.stringify(audience), JSON.stringify(attachmentIds || []), id]
  );
  return result.affectedRows > 0;
}

export async function publishAnnouncement(id) {
  const [result] = await pool.query(
    "UPDATE announcements SET status='published', published_at=NOW() WHERE id=?",
    [id]
  );
  return result.affectedRows > 0;
}

export async function setAnnouncementStatus(id, status) {
  const [result] = await pool.query("UPDATE announcements SET status=? WHERE id=?", [status, id]);
  return result.affectedRows > 0;
}

export async function deleteAnnouncement(id) {
  const [result] = await pool.query("DELETE FROM announcements WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

// ── Student / Alumni Portal ─────────────────────────────────────────────
// Published announcements only, and only those actually addressed to this
// audience ("students" or "alumni"). Drafts and archived notices are never
// visible outside the Admin Panel, and the audience test runs in SQL so a
// notice aimed only at offices can't be read by a student who guesses its
// id.
export async function listPublishedForAudience(audienceKey) {
  const [rows] = await pool.query(
    `SELECT * FROM announcements
     WHERE status = 'published' AND JSON_CONTAINS(audience, JSON_QUOTE(?))
     ORDER BY COALESCE(published_at, created_at) DESC, id DESC`,
    [audienceKey]
  );
  return Promise.all(rows.map((r) => expandAttachments(parseRawRow(r))));
}

export async function getPublishedForAudience(id, audienceKey) {
  const [rows] = await pool.query(
    `SELECT * FROM announcements
     WHERE id = ? AND status = 'published' AND JSON_CONTAINS(audience, JSON_QUOTE(?))`,
    [id, audienceKey]
  );
  if (!rows[0]) return null;
  return expandAttachments(parseRawRow(rows[0]));
}

// "New and urgent notices" for the portal dashboard card. "New" is simply
// anything published in the last 7 days — deliberately computed rather
// than tracked per user, since a read/unread table would be a new table
// and the count only needs to be a nudge, not an inbox.
export async function getAudienceHighlights(audienceKey) {
  const [rows] = await pool.query(
    `SELECT
       SUM(published_at >= (NOW() - INTERVAL 7 DAY)) AS recent,
       SUM(priority = 'urgent') AS urgent,
       COUNT(*) AS total
     FROM announcements
     WHERE status = 'published' AND JSON_CONTAINS(audience, JSON_QUOTE(?))`,
    [audienceKey]
  );
  const row = rows[0] || {};
  return { recent: Number(row.recent || 0), urgent: Number(row.urgent || 0), total: Number(row.total || 0) };
}
