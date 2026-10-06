import { pool } from "../config/db.js";
import { getFiles } from "./uploadedFileRepo.js";

function parseScholarship(row) {
  return { ...row, requirements: (typeof row.requirements === "string" ? JSON.parse(row.requirements) : row.requirements) || [] };
}

// Files the SAA attached to a posting (application forms to download).
export async function listAttachments(scholarshipId) {
  const [links] = await pool.query("SELECT file_id FROM scholarship_attachments WHERE scholarship_id = ? ORDER BY id", [scholarshipId]);
  const files = await getFiles(links.map((l) => l.file_id));
  const order = links.map((l) => l.file_id);
  return files.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

export async function setAttachments(scholarshipId, fileIds) {
  await pool.query("DELETE FROM scholarship_attachments WHERE scholarship_id = ?", [scholarshipId]);
  const ids = [...new Set((fileIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length > 0) {
    await pool.query("INSERT INTO scholarship_attachments (scholarship_id, file_id) VALUES ?", [ids.map((id) => [scholarshipId, id])]);
  }
}

export async function listScholarships() {
  const [rows] = await pool.query(
    `SELECT s.*, COUNT(a.id) AS applicant_count
     FROM scholarships s LEFT JOIN scholarship_applicants a ON a.scholarship_id = s.id
     GROUP BY s.id ORDER BY s.created_at DESC`
  );
  return Promise.all(rows.map(async (r) => ({ ...parseScholarship(r), applicant_count: Number(r.applicant_count || 0), attachments: await listAttachments(r.id) })));
}

export async function getScholarship(id) {
  const [rows] = await pool.query("SELECT * FROM scholarships WHERE id = ?", [id]);
  return rows[0] ? { ...parseScholarship(rows[0]), attachments: await listAttachments(id) } : null;
}

export async function createScholarship({ name, provider, deadline, amount, externalLink, requirements }) {
  const [result] = await pool.query(
    `INSERT INTO scholarships (name, provider, deadline, amount, external_link, requirements, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [name, provider, deadline || null, amount || null, externalLink || null, JSON.stringify(requirements || [])]
  );
  return result.insertId;
}

export async function updateScholarship(id, { name, provider, deadline, amount, externalLink, requirements }) {
  const [result] = await pool.query(
    `UPDATE scholarships SET name=?, provider=?, deadline=?, amount=?, external_link=?, requirements=? WHERE id=?`,
    [name, provider, deadline || null, amount || null, externalLink || null, JSON.stringify(requirements || []), id]
  );
  return result.affectedRows > 0;
}

export async function setScholarshipStatus(id, status) {
  const [result] = await pool.query("UPDATE scholarships SET status = ? WHERE id = ?", [status, id]);
  return result.affectedRows > 0;
}

export async function deleteScholarship(id) {
  const [result] = await pool.query("DELETE FROM scholarships WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

// ── Applicant evaluation ────────────────────────────────────────────────
export async function listApplicants(scholarshipId) {
  const [rows] = await pool.query(
    "SELECT * FROM scholarship_applicants WHERE scholarship_id = ? ORDER BY applied_at DESC",
    [scholarshipId]
  );
  return Promise.all(rows.map(async (applicant) => {
    const [fileLinks] = await pool.query(
      "SELECT file_id, label FROM scholarship_applicant_files WHERE applicant_id = ?",
      [applicant.id]
    );
    const files = await getFiles(fileLinks.map((f) => f.file_id));
    return { ...applicant, files };
  }));
}

export async function addApplicantFile(applicantId, fileId, label) {
  const [result] = await pool.query(
    "INSERT INTO scholarship_applicant_files (applicant_id, file_id, label) VALUES (?, ?, ?)",
    [applicantId, fileId, label || null]
  );
  return result.insertId;
}

export async function createApplicant({ scholarshipId, studentName, studentId, program }) {
  const [result] = await pool.query(
    "INSERT INTO scholarship_applicants (scholarship_id, student_name, student_id, program, status) VALUES (?, ?, ?, ?, 'pending')",
    [scholarshipId, studentName, studentId || null, program || null]
  );
  return result.insertId;
}

// Full detail for one applicant, independent of which scholarship it
// belongs to — used by the Report Generation "Individual Scholarship
// Application" record, which is picked directly by applicant, not by
// first drilling into a scholarship.
export async function getApplicantById(applicantId) {
  const [rows] = await pool.query(
    `SELECT a.*, s.name AS scholarship_name, s.provider AS scholarship_provider,
            s.amount AS scholarship_amount, s.deadline AS scholarship_deadline,
            s.requirements AS scholarship_requirements
     FROM scholarship_applicants a
     JOIN scholarships s ON s.id = a.scholarship_id
     WHERE a.id = ?`,
    [applicantId]
  );
  const applicant = rows[0];
  if (!applicant) return null;
  const [fileLinks] = await pool.query(
    "SELECT file_id, label FROM scholarship_applicant_files WHERE applicant_id = ?",
    [applicantId]
  );
  const files = await getFiles(fileLinks.map((f) => f.file_id));
  const requirements =
    (typeof applicant.scholarship_requirements === "string"
      ? JSON.parse(applicant.scholarship_requirements)
      : applicant.scholarship_requirements) || [];
  return { ...applicant, requirements, files };
}

// Flat, lightweight list for the Report Generation "pick a student"
// lookup — every applicant across every scholarship, newest first.
export async function listAllApplicantsForLookup() {
  const [rows] = await pool.query(
    `SELECT a.id, a.student_name, a.student_id, a.status, s.name AS scholarship_name
     FROM scholarship_applicants a
     JOIN scholarships s ON s.id = a.scholarship_id
     ORDER BY a.applied_at DESC`
  );
  return rows;
}

export async function decideApplicant(applicantId, status) {
  const [result] = await pool.query(
    "UPDATE scholarship_applicants SET status = ?, decided_at = NOW() WHERE id = ?",
    [status, applicantId]
  );
  return result.affectedRows > 0;
}

// When an applicant is accepted, they become part of the recipient roster.
export async function promoteApplicantToRecipient(applicantId) {
  const [[applicant]] = await pool.query(
    `SELECT a.*, s.name AS scholarship_name FROM scholarship_applicants a
     JOIN scholarships s ON s.id = a.scholarship_id WHERE a.id = ?`,
    [applicantId]
  );
  if (!applicant) return null;
  const [result] = await pool.query(
    `INSERT INTO scholarship_recipients (scholarship_id, student_name, student_id, status)
     VALUES (?, ?, ?, 'Granted')`,
    [applicant.scholarship_id, applicant.student_name, applicant.student_id]
  );
  return result.insertId;
}

// ── Recipient master roster + historical ingestion (spec section 24) ────
export async function listCategories() {
  const [rows] = await pool.query("SELECT * FROM scholarship_categories ORDER BY name");
  return rows;
}

export async function createCategory(name, kind) {
  const [result] = await pool.query(
    "INSERT INTO scholarship_categories (name, kind) VALUES (?, ?)",
    [name, kind || "historical"]
  );
  return result.insertId;
}

export async function listRecipients({ scholarshipId, categoryId } = {}) {
  const clauses = [];
  const params = [];
  if (scholarshipId) {
    clauses.push("r.scholarship_id = ?");
    params.push(scholarshipId);
  }
  if (categoryId) {
    clauses.push("r.category_id = ?");
    params.push(categoryId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT r.*, s.name AS scholarship_name, s.provider AS scholarship_provider, c.name AS category_name
     FROM scholarship_recipients r
     LEFT JOIN scholarships s ON s.id = r.scholarship_id
     LEFT JOIN scholarship_categories c ON c.id = r.category_id
     ${where}
     ORDER BY r.created_at DESC`,
    params
  );
  return rows;
}

export async function addManualRecipient({ categoryId, studentName, studentId, program, term, amount, status }) {
  const [result] = await pool.query(
    `INSERT INTO scholarship_recipients (category_id, student_name, student_id, program, term, amount, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [categoryId, studentName, studentId || null, program || null, term || null, amount || null, status || "Granted"]
  );
  return result.insertId;
}

// ── Student Portal ──────────────────────────────────────────────────────
// Only postings still open for application. Each carries whether THIS
// student has already applied, so the card can show "Applied" instead of
// letting them file a duplicate.
export async function listOpenScholarshipsForUser(userId) {
  const [rows] = await pool.query(
    `SELECT s.*, a.id AS my_application_id, a.status AS my_application_status, a.applied_at AS my_applied_at,
            (s.deadline IS NOT NULL AND s.deadline < CURDATE()) AS deadline_passed
     FROM scholarships s
     LEFT JOIN scholarship_applicants a ON a.scholarship_id = s.id AND a.user_id = ?
     WHERE s.status = 'active'
     ORDER BY (s.deadline IS NULL), s.deadline ASC, s.created_at DESC`,
    [userId]
  );
  return Promise.all(rows.map(async (r) => ({ ...parseScholarship(r), attachments: await listAttachments(r.id) })));
}

export async function getOpenScholarship(id) {
  const [rows] = await pool.query("SELECT * FROM scholarships WHERE id = ? AND status = 'active'", [id]);
  return rows[0] ? parseScholarship(rows[0]) : null;
}

// "My Scholarship Applications" — every application this student filed,
// with the requirement files they attached to each.
export async function listApplicationsForUser(userId) {
  const [rows] = await pool.query(
    `SELECT a.*, s.name AS scholarship_name, s.provider AS scholarship_provider,
            s.amount AS scholarship_amount, s.deadline AS scholarship_deadline
     FROM scholarship_applicants a
     JOIN scholarships s ON s.id = a.scholarship_id
     WHERE a.user_id = ?
     ORDER BY a.applied_at DESC`,
    [userId]
  );
  return Promise.all(
    rows.map(async (applicant) => {
      const [fileLinks] = await pool.query(
        "SELECT file_id, label FROM scholarship_applicant_files WHERE applicant_id = ?",
        [applicant.id]
      );
      const files = await getFiles(fileLinks.map((f) => f.file_id));
      const labelled = files.map((f) => ({ ...f, label: fileLinks.find((l) => l.file_id === f.id)?.label || null }));
      return { ...applicant, files: labelled };
    })
  );
}

export async function hasUserApplied(userId, scholarshipId) {
  const [rows] = await pool.query(
    "SELECT id FROM scholarship_applicants WHERE user_id = ? AND scholarship_id = ? LIMIT 1",
    [userId, scholarshipId]
  );
  return rows.length > 0;
}

export async function createApplicantForUser({ scholarshipId, userId, studentName, studentId, program }) {
  const [result] = await pool.query(
    `INSERT INTO scholarship_applicants (scholarship_id, user_id, student_name, student_id, program, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [scholarshipId, userId, studentName, studentId || null, program || null]
  );
  return result.insertId;
}

export async function getApplicationCountsForUser(userId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'pending') AS pending,
            SUM(status = 'accepted') AS accepted,
            SUM(status = 'rejected') AS rejected
     FROM scholarship_applicants WHERE user_id = ?`,
    [userId]
  );
  const r = rows[0] || {};
  const num = (v) => Number(v || 0);
  return { total: num(r.total), pending: num(r.pending), accepted: num(r.accepted), rejected: num(r.rejected) };
}
