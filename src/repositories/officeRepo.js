import { pool } from "../config/db.js";

export async function listOffices() {
  const [rows] = await pool.query(
    `SELECT o.id, o.name, o.category, u.email AS username, u.status AS account_status
     FROM offices o LEFT JOIN users u ON u.id = o.user_id
     ORDER BY o.category, o.name`
  );
  return rows;
}

export async function officeExists(officeId) {
  const [rows] = await pool.query("SELECT id FROM offices WHERE id = ? LIMIT 1", [officeId]);
  return rows.length > 0;
}

// ── Office Portal ────────────────────────────────────────────────────────
// Every office row that has a real login account — used by the admin's
// "Request Document from Office" picker, since that request has to land in
// someone's Office Portal inbox, unlike e-signature routing (which still
// works without a portal account, via the admin's "sign on behalf of").
export async function listOfficesWithAccounts() {
  const [rows] = await pool.query(
    `SELECT o.id, o.name, o.category, u.email AS username
     FROM offices o JOIN users u ON u.id = o.user_id
     ORDER BY o.category, o.name`
  );
  return rows;
}

export async function getOffice(officeId) {
  const [rows] = await pool.query("SELECT * FROM offices WHERE id = ?", [officeId]);
  return rows[0] || null;
}

// The office row a signed-in Office Portal account (users.type='offices')
// belongs to. Every office-facing controller resolves this first, then
// scopes everything else off officeId — a portal session never carries an
// officeId of its own, so it can't be spoofed from the request body.
export async function getOfficeByUserId(userId) {
  const [rows] = await pool.query("SELECT * FROM offices WHERE user_id = ? LIMIT 1", [userId]);
  return rows[0] || null;
}
