import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";

const SAFE_COLUMNS = "id, code, name, email, type, department, status, created_at";

export async function listUsers({ search, type, status } = {}) {
  const clauses = [];
  const params = [];
  if (search) {
    clauses.push("(name LIKE ? OR email LIKE ? OR code LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (type) {
    clauses.push("type = ?");
    params.push(type);
  }
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await pool.query(`SELECT ${SAFE_COLUMNS} FROM users ${where} ORDER BY id DESC`, params);
  return rows;
}

export async function getUser(id) {
  const [rows] = await pool.query(`SELECT ${SAFE_COLUMNS} FROM users WHERE id = ?`, [id]);
  return rows[0] || null;
}

export async function codeExists(code) {
  const [rows] = await pool.query("SELECT id FROM users WHERE code = ? LIMIT 1", [code]);
  return rows.length > 0;
}

export async function countUsers() {
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS total, SUM(status = 'pending') AS pending FROM users"
  );
  return { total: Number(rows[0].total), pending: Number(rows[0].pending || 0) };
}

// The admin sets the password directly (there's no self-service sign-up);
// it's hashed here before ever touching the database, same as the admin
// account's own password.
export async function createUser({ code, name, email, password, type, department, status }) {
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  const [result] = await pool.query(
    `INSERT INTO users (code, name, email, password_hash, type, department, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [code, name, email || null, passwordHash, type, department || null, status || "active"]
  );
  return result.insertId;
}

export async function updateUser(id, { code, name, email, password, type, department, status }) {
  if (password) {
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      `UPDATE users SET code=?, name=?, email=?, password_hash=?, type=?, department=?, status=? WHERE id=?`,
      [code, name, email || null, passwordHash, type, department || null, status, id]
    );
    return result.affectedRows > 0;
  }
  const [result] = await pool.query(
    `UPDATE users SET code=?, name=?, email=?, type=?, department=?, status=? WHERE id=?`,
    [code, name, email || null, type, department || null, status, id]
  );
  return result.affectedRows > 0;
}

export async function updateUserStatus(id, status) {
  const [result] = await pool.query("UPDATE users SET status = ? WHERE id = ?", [status, id]);
  return result.affectedRows > 0;
}

export async function deleteUser(id) {
  const [result] = await pool.query("DELETE FROM users WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

// Maps an announcement's audience array (["students","alumni","offices"])
// to matching active users with an email on file.
const AUDIENCE_TO_TYPE = { students: "student", alumni: "alumni", offices: "offices" };
export async function getEmailsForAudience(audience) {
  const types = (audience || []).map((a) => AUDIENCE_TO_TYPE[a]).filter(Boolean);
  if (types.length === 0) return [];
  const [rows] = await pool.query(
    `SELECT email FROM users WHERE type IN (${types.map(() => "?").join(",")}) AND status = 'active' AND email IS NOT NULL AND email != ''`,
    types
  );
  return rows.map((r) => r.email);
}
