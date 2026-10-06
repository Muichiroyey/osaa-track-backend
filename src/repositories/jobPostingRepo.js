import { pool } from "../config/db.js";

export async function listJobPostings() {
  const [rows] = await pool.query("SELECT * FROM job_postings ORDER BY created_at DESC");
  return rows;
}

export async function createJobPosting(data) {
  const [result] = await pool.query(
    `INSERT INTO job_postings (title, industry, company, location, deadline, description, requirements, external_link, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [data.title, data.industry || null, data.company, data.location || null, data.deadline || null, data.description || null, data.requirements || null, data.externalLink || null]
  );
  return result.insertId;
}

export async function updateJobPosting(id, data) {
  const [result] = await pool.query(
    `UPDATE job_postings SET title=?, industry=?, company=?, location=?, deadline=?, description=?, requirements=?, external_link=? WHERE id=?`,
    [data.title, data.industry || null, data.company, data.location || null, data.deadline || null, data.description || null, data.requirements || null, data.externalLink || null, id]
  );
  return result.affectedRows > 0;
}

export async function setJobPostingStatus(id, status) {
  const [result] = await pool.query("UPDATE job_postings SET status = ? WHERE id = ?", [status, id]);
  return result.affectedRows > 0;
}

export async function deleteJobPosting(id) {
  const [result] = await pool.query("DELETE FROM job_postings WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

// ── Alumni Portal ───────────────────────────────────────────────────────
// Alumni see the career board, so only postings the admin has left active.
export async function listActiveJobPostings() {
  const [rows] = await pool.query(
    "SELECT * FROM job_postings WHERE status = 'active' ORDER BY (deadline IS NULL), deadline ASC, created_at DESC"
  );
  return rows;
}

export async function getActiveJobPosting(id) {
  const [rows] = await pool.query("SELECT * FROM job_postings WHERE id = ? AND status = 'active'", [id]);
  return rows[0] || null;
}

export async function countActiveJobPostings() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS active,
            SUM(deadline IS NOT NULL AND deadline >= CURDATE() AND deadline <= (CURDATE() + INTERVAL 14 DAY)) AS closingSoon
     FROM job_postings WHERE status = 'active'`
  );
  return { active: Number(rows[0].active || 0), closingSoon: Number(rows[0].closingSoon || 0) };
}
