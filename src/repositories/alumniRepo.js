import { pool } from "../config/db.js";

export async function listAlumniProfiles({ program, batchYear, employmentStatus } = {}) {
  const clauses = [];
  const params = [];
  if (program) {
    clauses.push("program = ?");
    params.push(program);
  }
  if (batchYear) {
    clauses.push("batch_year = ?");
    params.push(batchYear);
  }
  if (employmentStatus) {
    clauses.push("employment_status = ?");
    params.push(employmentStatus);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await pool.query(`SELECT * FROM alumni_profiles ${where} ORDER BY batch_year DESC, name`, params);
  return rows;
}

export async function createAlumniProfile({ name, program, batchYear, employmentStatus, employer, jobDescription }) {
  const [result] = await pool.query(
    "INSERT INTO alumni_profiles (name, program, batch_year, employment_status, employer, job_description) VALUES (?, ?, ?, ?, ?, ?)",
    [name, program || null, batchYear || null, employmentStatus || null, employer || null, jobDescription || null]
  );
  return result.insertId;
}

export async function updateAlumniProfile(id, { name, program, batchYear, employmentStatus, employer, jobDescription }) {
  const [result] = await pool.query(
    "UPDATE alumni_profiles SET name = ?, program = ?, batch_year = ?, employment_status = ?, employer = ?, job_description = ? WHERE id = ?",
    [name, program || null, batchYear || null, employmentStatus || null, employer || null, jobDescription || null, id]
  );
  return result.affectedRows > 0;
}

export async function deleteAlumniProfile(id) {
  const [result] = await pool.query("DELETE FROM alumni_profiles WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

// ── Alumni Portal ───────────────────────────────────────────────────────
// One profile row per alumni account (alumni_profiles.user_id is UNIQUE).
// The admin's own Add/Delete flow on the Alumni Profiles page is untouched
// — rows it creates simply have no user_id until an account claims one.
export async function getProfileByUserId(userId) {
  const [rows] = await pool.query("SELECT * FROM alumni_profiles WHERE user_id = ?", [userId]);
  return rows[0] || null;
}

// Claims an existing unclaimed profile with a matching name before
// creating a second one, so an alumnus the admin already entered by hand
// updates that record instead of ending up duplicated in the directory.
export async function claimProfileForUser(userId, name) {
  const [rows] = await pool.query(
    `SELECT id FROM alumni_profiles WHERE user_id IS NULL AND name = ? ORDER BY id LIMIT 1`,
    [name]
  );
  if (!rows[0]) return null;
  await pool.query("UPDATE alumni_profiles SET user_id = ? WHERE id = ?", [userId, rows[0].id]);
  return rows[0].id;
}

export async function upsertProfileForUser(userId, { name, program, batchYear, employmentStatus, employer, jobDescription }) {
  const existing = await getProfileByUserId(userId);
  if (existing) {
    await pool.query(
      `UPDATE alumni_profiles SET name=?, program=?, batch_year=?, employment_status=?, employer=?, job_description=?
       WHERE id = ?`,
      [name, program || null, batchYear || null, employmentStatus || null, employer || null, jobDescription || null, existing.id]
    );
    return existing.id;
  }
  const [result] = await pool.query(
    `INSERT INTO alumni_profiles (user_id, name, program, batch_year, employment_status, employer, job_description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, name, program || null, batchYear || null, employmentStatus || null, employer || null, jobDescription || null]
  );
  return result.insertId;
}
