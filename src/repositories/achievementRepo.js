import { pool } from "../config/db.js";
import { getFiles } from "./uploadedFileRepo.js";

// Programs and colors match the Figma "Select Program" grid exactly
// (spec section 25 college/program categorization, as designed).
export const COLLEGE_PROGRAMS = {
  "College of Arts Sciences and Letters": [
    "BA in English Language",
    "BA in Economics",
    "BS in Biology",
    "BS in Nutrition and Dietetics",
    "BS in Social Work",
  ],
  "College of Business and Public Administration": [
    "Bachelor of Public Administration",
    "BS in Business Administration",
  ],
  "College of Computing Sciences": [
    "BS in Computer Science",
    "BS in Information Technology",
    "BS in Mathematics",
  ],
  "College of Tourism and Hospitality Management": [
    "BS in Hospitality Management",
    "BS in Tourism Management",
  ],
  "College of Teacher Education": [
    "Bachelor of Secondary Education",
    "Technical Vocational Teacher Education",
    "Technology and Livelihood Education",
  ],
  "College of Industrial Technology": ["Bachelor of Industrial Technology"],
};

// Per-program card color, matching the Figma gradient for each card exactly.
export const PROGRAM_COLORS = {
  "BA in English Language": [236, 72, 153],
  "BA in Economics": [245, 158, 11],
  "BS in Biology": [14, 165, 233],
  "BS in Nutrition and Dietetics": [20, 184, 166],
  "BS in Social Work": [249, 115, 22],
  "Bachelor of Public Administration": [139, 92, 246],
  "BS in Business Administration": [6, 182, 212],
  "BS in Computer Science": [99, 102, 241],
  "BS in Information Technology": [59, 130, 246],
  "BS in Mathematics": [16, 185, 129],
  "BS in Hospitality Management": [244, 63, 94],
  "BS in Tourism Management": [168, 85, 247],
  "Bachelor of Secondary Education": [100, 116, 139],
  "Technical Vocational Teacher Education": [217, 119, 6],
  "Technology and Livelihood Education": [22, 163, 74],
  "Bachelor of Industrial Technology": [220, 38, 38],
};

export async function programCounts() {
  const [rows] = await pool.query(
    "SELECT program, COUNT(DISTINCT student_name) AS achievers FROM achievements GROUP BY program"
  );
  const map = {};
  rows.forEach((r) => {
    map[r.program] = Number(r.achievers);
  });
  return map;
}

export async function listAchievements({ college, program, status } = {}) {
  const clauses = [];
  const params = [];
  if (college) {
    clauses.push("college = ?");
    params.push(college);
  }
  if (program) {
    clauses.push("program = ?");
    params.push(program);
  }
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT a.*, (SELECT u.name FROM users u WHERE u.id = a.staff_verified_by_user_id) AS staff_verified_by_name
     FROM achievements a ${where} ORDER BY a.submitted_at DESC`,
    params
  );
  return Promise.all(rows.map(async (a) => {
    const [fileLinks] = await pool.query("SELECT file_id FROM achievement_files WHERE achievement_id = ?", [a.id]);
    const files = await getFiles(fileLinks.map((f) => f.file_id));
    return { ...a, files };
  }));
}

export async function getAchievementById(id) {
  const [rows] = await pool.query(
    `SELECT a.*, (SELECT u.name FROM users u WHERE u.id = a.staff_verified_by_user_id) AS staff_verified_by_name
     FROM achievements a WHERE a.id = ?`,
    [id]
  );
  const achievement = rows[0];
  if (!achievement) return null;
  const [fileLinks] = await pool.query("SELECT file_id FROM achievement_files WHERE achievement_id = ?", [id]);
  const files = await getFiles(fileLinks.map((f) => f.file_id));
  return { ...achievement, files };
}

// Flat, lightweight list for the Report Generation "pick a student" lookup
// — every achievement submission, newest first, no attachments (those are
// only fetched once a specific one is picked via getAchievementById).
export async function listAllForLookup() {
  const [rows] = await pool.query(
    "SELECT id, student_name, college, program, title, status FROM achievements ORDER BY submitted_at DESC"
  );
  return rows;
}

export async function addAchievementFile(achievementId, fileId, label) {
  const [result] = await pool.query(
    "INSERT INTO achievement_files (achievement_id, file_id, label) VALUES (?, ?, ?)",
    [achievementId, fileId, label || null]
  );
  return result.insertId;
}

export async function createAchievement({ studentName, college, program, title, description }) {
  const [result] = await pool.query(
    `INSERT INTO achievements (student_name, college, program, title, description, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [studentName, college, program, title, description || null]
  );
  return result.insertId;
}

export async function decideAchievement(id, status, rejectionReason) {
  const [result] = await pool.query(
    "UPDATE achievements SET status=?, rejection_reason=?, decided_at=NOW() WHERE id=?",
    [status, status === "rejected" ? rejectionReason || null : null, id]
  );
  return result.affectedRows > 0;
}

// ── Student Portal ──────────────────────────────────────────────────────
// A student's own submissions, with the proof files they attached.
export async function listAchievementsForUser(userId) {
  const [rows] = await pool.query(
    "SELECT * FROM achievements WHERE user_id = ? ORDER BY submitted_at DESC",
    [userId]
  );
  return Promise.all(
    rows.map(async (a) => {
      const [fileLinks] = await pool.query("SELECT file_id FROM achievement_files WHERE achievement_id = ?", [a.id]);
      const files = await getFiles(fileLinks.map((f) => f.file_id));
      return { ...a, files };
    })
  );
}

export async function getAchievementForUser(id, userId) {
  const [rows] = await pool.query("SELECT * FROM achievements WHERE id = ? AND user_id = ?", [id, userId]);
  if (!rows[0]) return null;
  const [fileLinks] = await pool.query("SELECT file_id FROM achievement_files WHERE achievement_id = ?", [id]);
  const files = await getFiles(fileLinks.map((f) => f.file_id));
  return { ...rows[0], files };
}

// Same achievements table the Admin Panel's Achievement Management reads —
// a submission from the portal simply arrives there as 'pending' under the
// student's program, exactly like one the admin entered by hand.
export async function createAchievementForUser({
  userId, studentName, college, program, yearLevel, title, description, dateAchieved, studentNumber = null, collegeEntered = null,
}) {
  const [result] = await pool.query(
    `INSERT INTO achievements (user_id, student_name, college, program, year_level, student_number, college_entered, title, description, date_achieved, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [userId, studentName, college, program, yearLevel || null, studentNumber || null, collegeEntered || null, title, description || null, dateAchieved || null]
  );
  return result.insertId;
}

export async function getAchievementCountsForUser(userId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total,
            SUM(status = 'pending') AS pending,
            SUM(status = 'approved') AS approved,
            SUM(status = 'rejected') AS rejected
     FROM achievements WHERE user_id = ?`,
    [userId]
  );
  const r = rows[0] || {};
  const num = (v) => Number(v || 0);
  return { total: num(r.total), pending: num(r.pending), approved: num(r.approved), rejected: num(r.rejected) };
}

// Reverse lookup: the student's form asks for their program, and the
// college is derived from it rather than asked twice — the admin's create
// endpoint validates that the pair actually matches, so deriving it keeps
// the two panels from ever disagreeing.
export function collegeForProgram(program) {
  return Object.keys(COLLEGE_PROGRAMS).find((college) => COLLEGE_PROGRAMS[college].includes(program)) || null;
}


// ── SAA Staff Portal: initial screening ─────────────────────────────────
// Staff verify a submission and route it to the SAA Dean for the final
// decision. The status stays 'pending' (students see "under review"); only a
// still-pending record that hasn't been verified yet can be verified.
export async function staffVerifyAchievement(id, staffUserId, note) {
  const [result] = await pool.query(
    `UPDATE achievements
     SET staff_verified_at = NOW(), staff_verified_by_user_id = ?, staff_note = ?
     WHERE id = ? AND status = 'pending' AND staff_verified_at IS NULL`,
    [staffUserId, note ? String(note).trim() || null : null, id]
  );
  return result.affectedRows > 0;
}
