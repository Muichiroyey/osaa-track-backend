import { pool } from "../config/db.js";
import { getFiles } from "./uploadedFileRepo.js";

// officeId omitted (undefined) = SAA's own repository, admin's original
// behavior, completely unaffected. officeId = null explicitly also means
// "SAA's own" (used by the office-scoped queries below to stay out of each
// other's way). officeId = a real id scopes to that office's own private
// repository (Office Portal, spec section 6).
export async function listFolders(officeId) {
  const scoped = officeId !== undefined;
  const where = scoped ? (officeId === null ? "WHERE f.office_id IS NULL" : "WHERE f.office_id = ?") : "";
  const params = scoped && officeId !== null ? [officeId] : [];
  const [rows] = await pool.query(
    `SELECT f.id, f.name, f.office_id, f.created_at,
            SUM(df.status = 'active') AS file_count
     FROM document_folders f
     LEFT JOIN document_files df ON df.folder_id = f.id
     ${where}
     GROUP BY f.id
     ORDER BY f.name`,
    params
  );
  return rows.map((r) => ({ ...r, file_count: Number(r.file_count || 0) }));
}

export async function getFolder(id) {
  const [rows] = await pool.query("SELECT * FROM document_folders WHERE id = ?", [id]);
  return rows[0] || null;
}

export async function createFolder(name, officeId = null) {
  const [result] = await pool.query(
    "INSERT INTO document_folders (name, office_id) VALUES (?, ?)",
    [name, officeId]
  );
  return result.insertId;
}

export async function deleteFolder(id) {
  const [result] = await pool.query("DELETE FROM document_folders WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

export async function listFiles(folderId) {
  const [rows] = await pool.query(
    "SELECT * FROM document_files WHERE folder_id = ? ORDER BY uploaded_at DESC",
    [folderId]
  );
  return rows;
}

export async function addFile(folderId, name, storedName) {
  const [result] = await pool.query(
    "INSERT INTO document_files (folder_id, name, stored_name) VALUES (?, ?, ?)",
    [folderId, name, storedName || null]
  );
  return result.insertId;
}

export async function getFile(id) {
  const [rows] = await pool.query("SELECT * FROM document_files WHERE id = ?", [id]);
  return rows[0] || null;
}

export async function setFileStatus(id, status) {
  const [result] = await pool.query("UPDATE document_files SET status = ? WHERE id = ?", [status, id]);
  return result.affectedRows > 0;
}

export async function deleteFile(id) {
  const [result] = await pool.query("DELETE FROM document_files WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

// The SAA office has no row in `offices`; a transmission whose office_id is
// NULL is addressed to it.
export const SAA_OFFICE_LABEL = "Office of Student and Alumni Affairs";

// Every file on a transmission, each tagged with whether it was attached when
// sent ('original') or uploaded back to answer a request ('response').
async function filesFor(transmissionId) {
  const [links] = await pool.query("SELECT file_id, kind FROM transmission_files WHERE transmission_id = ? ORDER BY id", [transmissionId]);
  const files = await getFiles(links.map((l) => l.file_id));
  const kindOf = new Map(links.map((l) => [l.file_id, l.kind]));
  const order = links.map((l) => l.file_id);
  return files
    .map((f) => ({ ...f, kind: kindOf.get(f.id) || "original" }))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

// ── Inter-office transmission (send to / request from authorized offices
// only; the controller checks officeExists() first). office_id is always
// the counterpart; from_office_id is who initiated it (NULL = admin, the
// original and still-default behavior). ──────────────────────────────────
export async function listTransmissions() {
  const [rows] = await pool.query(
    `SELECT t.*, COALESCE(o.name, '${SAA_OFFICE_LABEL}') AS office_name, o.category AS office_category,
            f.name AS from_office_name
     FROM document_transmissions t
     LEFT JOIN offices o ON o.id = t.office_id
     LEFT JOIN offices f ON f.id = t.from_office_id
     ORDER BY t.created_at DESC`
  );
  return Promise.all(rows.map(async (t) => {
    return { ...t, files: await filesFor(t.id) };
  }));
}

// Office Portal — a given office's involvement either way: as the
// counterpart of something the admin or another office started with them,
// or as the office that started it.
export async function listTransmissionsForOffice(officeId) {
  const [rows] = await pool.query(
    `SELECT t.*, COALESCE(o.name, '${SAA_OFFICE_LABEL}') AS office_name, o.category AS office_category,
            f.name AS from_office_name
     FROM document_transmissions t
     LEFT JOIN offices o ON o.id = t.office_id
     LEFT JOIN offices f ON f.id = t.from_office_id
     WHERE t.office_id = ? OR t.from_office_id = ?
     ORDER BY t.created_at DESC`,
    [officeId, officeId]
  );
  return Promise.all(rows.map(async (t) => {
    return { ...t, files: await filesFor(t.id) };
  }));
}

export async function getTransmission(id) {
  const [rows] = await pool.query("SELECT * FROM document_transmissions WHERE id = ?", [id]);
  return rows[0] || null;
}

export async function createTransmission({ direction, officeId, fromOfficeId = null, documentName, notes }) {
  const [result] = await pool.query(
    "INSERT INTO document_transmissions (direction, office_id, from_office_id, document_name, notes) VALUES (?, ?, ?, ?, ?)",
    [direction, officeId, fromOfficeId, documentName, notes || null]
  );
  return result.insertId;
}

export async function addTransmissionFile(transmissionId, fileId, kind = "original") {
  const [result] = await pool.query(
    "INSERT INTO transmission_files (transmission_id, file_id, kind) VALUES (?, ?, ?)",
    [transmissionId, fileId, kind]
  );
  return result.insertId;
}

// The receiving side answers a request: the uploaded file(s) go back to the
// requester and the request is closed out as fulfilled.
export async function respondToTransmission(id, fileIds) {
  for (const fileId of fileIds) await addTransmissionFile(id, fileId, "response");
  await pool.query("UPDATE document_transmissions SET status = 'fulfilled', responded_at = NOW() WHERE id = ?", [id]);
}

export async function setTransmissionStatus(id, status) {
  const [result] = await pool.query("UPDATE document_transmissions SET status = ? WHERE id = ?", [status, id]);
  return result.affectedRows > 0;
}
