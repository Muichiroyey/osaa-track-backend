import { pool } from "../config/db.js";
import { getFiles } from "./uploadedFileRepo.js";

export async function listEndorsements({ direction } = {}) {
  const clauses = [];
  const params = [];
  if (direction) {
    clauses.push("e.direction = ?");
    params.push(direction);
  }
  // A "Search for Student" sent to ALL offices is stored as one row per office;
  // the admin's list shows it once, not once per office.
  clauses.push("(e.batch_key IS NULL OR e.id = (SELECT MIN(x.id) FROM endorsements x WHERE x.batch_key = e.batch_key))");
  const where = `WHERE ${clauses.join(" AND ")}`;
  const [rows] = await pool.query(
    `SELECT e.*, o.name AS office_name, o.category AS office_category,
            src.name AS source_office_name
     FROM endorsements e
     JOIN offices o ON o.id = e.office_id
     LEFT JOIN offices src ON src.id = e.source_office_id
     ${where} ORDER BY e.created_at DESC`,
    params
  );
  return Promise.all(rows.map(async (e) => {
    const [fileLinks] = await pool.query("SELECT file_id FROM endorsement_files WHERE endorsement_id = ?", [e.id]);
    const files = await getFiles(fileLinks.map((f) => f.file_id));
    return { ...e, files };
  }));
}

// Office Portal (spec section 5) — everything involving a given office,
// both directions: what it sent out (source_office_id = mine) and what it
// received, whether from SAA directly (source_office_id NULL) or from
// another office (source_office_id = someone else) — either way,
// office_id = mine is what makes it "received".
export async function listEndorsementsForOffice(officeId) {
  const [rows] = await pool.query(
    `SELECT e.*, o.name AS office_name, o.category AS office_category,
            src.name AS source_office_name,
            (e.source_office_id = ?) AS is_mine
     FROM endorsements e
     JOIN offices o ON o.id = e.office_id
     LEFT JOIN offices src ON src.id = e.source_office_id
     WHERE e.office_id = ? OR e.source_office_id = ?
     ORDER BY e.created_at DESC`,
    [officeId, officeId, officeId]
  );
  // A "Search for Student" sent to ALL offices is stored as one row per office.
  // The sender sees it once, labelled "All offices", not 60-odd identical cards.
  const seenBatches = new Set();
  const visible = [];
  for (const e of rows) {
    if (e.batch_key && e.source_office_id === officeId) {
      if (seenBatches.has(e.batch_key)) continue;
      seenBatches.add(e.batch_key);
      visible.push({ ...e, office_name: "All offices" });
    } else {
      visible.push(e);
    }
  }
  return Promise.all(visible.map(async (e) => {
    const [fileLinks] = await pool.query("SELECT file_id FROM endorsement_files WHERE endorsement_id = ?", [e.id]);
    const files = await getFiles(fileLinks.map((f) => f.file_id));
    return { ...e, files };
  }));
}

export async function getEndorsement(id) {
  const [rows] = await pool.query(
    `SELECT e.*, o.name AS office_name, o.category AS office_category, src.name AS source_office_name
     FROM endorsements e JOIN offices o ON o.id = e.office_id
     LEFT JOIN offices src ON src.id = e.source_office_id
     WHERE e.id = ?`,
    [id]
  );
  if (!rows[0]) return null;
  const [fileLinks] = await pool.query("SELECT file_id FROM endorsement_files WHERE endorsement_id = ?", [id]);
  const files = await getFiles(fileLinks.map((f) => f.file_id));
  return { ...rows[0], files };
}

// Inbound endorsements filed by the ADMIN (received from another office)
// only need the source office + notes — no student identity fields, per
// admin request. Every other case (admin's own outbound referrals, and
// every endorsement an Office Portal account files itself — sourceOfficeId
// set — which is always a real referral, never a bare notes-only record)
// keeps the full student identity fields.
export async function createEndorsement({ direction, studentName, studentId, program, officeId, sourceOfficeId, purpose, background, justification, kind = "referral", batchKey = null, replyToId = null }) {
  const isInbound = direction === "inbound" && !sourceOfficeId;
  const [result] = await pool.query(
    `INSERT INTO endorsements (direction, student_name, student_id, program, office_id, source_office_id, purpose, background, justification, status, kind, batch_key, reply_to_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      direction,
      isInbound ? null : studentName || null,
      isInbound ? null : studentId || null,
      isInbound ? null : program || null,
      officeId,
      sourceOfficeId || null,
      purpose || null,
      background || null,
      justification || null,
      kind,
      batchKey,
      replyToId,
    ]
  );
  return result.insertId;
}

export async function addEndorsementFile(endorsementId, fileId) {
  const [result] = await pool.query(
    "INSERT INTO endorsement_files (endorsement_id, file_id) VALUES (?, ?)",
    [endorsementId, fileId]
  );
  return result.insertId;
}

export async function setEndorsementStatus(id, status) {
  const [result] = await pool.query("UPDATE endorsements SET status = ? WHERE id = ?", [status, id]);
  return result.affectedRows > 0;
}

// Office Portal — an office may only move the status of endorsements it is
// the RECIPIENT of (office_id = mine), same as the admin's own
// acknowledge/resolve action, just scoped.
export async function setEndorsementStatusForOffice(id, officeId, status) {
  const [result] = await pool.query(
    "UPDATE endorsements SET status = ? WHERE id = ? AND office_id = ?",
    [status, id, officeId]
  );
  return result.affectedRows > 0;
}
