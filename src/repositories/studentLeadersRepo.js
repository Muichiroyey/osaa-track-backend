import { pool } from "../config/db.js";
import { getFile, getFiles } from "./uploadedFileRepo.js";

// ── Organizations ────────────────────────────────────────────────────
async function hydrateOrganization(row) {
  const [orgLogo, collegeLogo, psuLogo, cblFile] = await Promise.all([
    row.org_logo_file_id ? getFile(row.org_logo_file_id) : null,
    row.college_logo_file_id ? getFile(row.college_logo_file_id) : null,
    row.psu_logo_file_id ? getFile(row.psu_logo_file_id) : null,
    row.cbl_file_id ? getFile(row.cbl_file_id) : null,
  ]);
  return { ...row, org_logo: orgLogo, college_logo: collegeLogo, psu_logo: psuLogo, cbl_file: cblFile };
}

export async function listOrganizations() {
  const [rows] = await pool.query(
    `SELECT o.*, COUNT(f.id) AS officer_count
     FROM student_organizations o
     LEFT JOIN org_officers f ON f.organization_id = o.id
     GROUP BY o.id
     ORDER BY o.name`
  );
  return Promise.all(rows.map((r) => hydrateOrganization({ ...r, officer_count: Number(r.officer_count || 0) })));
}

export async function getOrganization(id) {
  const [rows] = await pool.query("SELECT * FROM student_organizations WHERE id = ?", [id]);
  if (!rows[0]) return null;
  return hydrateOrganization(rows[0]);
}

export async function organizationExists(id) {
  const [rows] = await pool.query("SELECT id FROM student_organizations WHERE id = ?", [id]);
  return rows.length > 0;
}

export async function createOrganization({ name, orgLogoFileId, collegeName, collegeLogoFileId, psuName, psuLogoFileId }) {
  const [result] = await pool.query(
    `INSERT INTO student_organizations (name, org_logo_file_id, college_name, college_logo_file_id, psu_name, psu_logo_file_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, orgLogoFileId || null, collegeName || null, collegeLogoFileId || null, psuName?.trim() || "Pangasinan State University", psuLogoFileId || null]
  );
  return result.insertId;
}

export async function updateOrganization(id, { name, orgLogoFileId, collegeName, collegeLogoFileId, psuName, psuLogoFileId }) {
  const [result] = await pool.query(
    `UPDATE student_organizations
     SET name = ?, org_logo_file_id = ?, college_name = ?, college_logo_file_id = ?, psu_name = ?, psu_logo_file_id = ?
     WHERE id = ?`,
    [name, orgLogoFileId || null, collegeName || null, collegeLogoFileId || null, psuName?.trim() || "Pangasinan State University", psuLogoFileId || null, id]
  );
  return result.affectedRows > 0;
}

export async function deleteOrganization(id) {
  const [result] = await pool.query("DELETE FROM student_organizations WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

// ── Office Portal (spec section 7 — CREATE ONE ORGANIZATION) ───────────
export async function getOrganizationByOffice(officeId) {
  const [rows] = await pool.query("SELECT * FROM student_organizations WHERE office_id = ?", [officeId]);
  if (!rows[0]) return null;
  return hydrateOrganization(rows[0]);
}

// "Step 3 – Check Office Organization": if a pre-seeded organization
// exists with a matching name and no office has claimed it yet, this
// office's own record IS that one — claim it rather than making a
// duplicate row. Otherwise it's a genuinely new organization.
export async function claimOrCreateOrganizationForOffice(officeId, { name, orgLogoFileId, collegeName, collegeLogoFileId, psuName, psuLogoFileId }) {
  const existing = await getOrganizationByOffice(officeId);
  if (existing) {
    throw Object.assign(new Error("This office already has a registered organization."), { code: "ALREADY_REGISTERED" });
  }
  // The same organization can't be registered by two different offices
  // ("one organization, one owning office" — the mirror of "one organization
  // per office"). Only an organization nobody has claimed can be claimed.
  const [takenByOther] = await pool.query(
    "SELECT id FROM student_organizations WHERE office_id IS NOT NULL AND office_id <> ? AND LOWER(name) = LOWER(?) LIMIT 1",
    [officeId, name]
  );
  if (takenByOther[0]) {
    throw Object.assign(new Error("An organization with this name is already registered by another office."), { code: "ALREADY_REGISTERED" });
  }
  const [unclaimed] = await pool.query(
    "SELECT id FROM student_organizations WHERE office_id IS NULL AND LOWER(name) = LOWER(?) LIMIT 1",
    [name]
  );
  if (unclaimed[0]) {
    await pool.query(
      `UPDATE student_organizations
       SET office_id = ?, org_logo_file_id = COALESCE(?, org_logo_file_id),
           college_name = COALESCE(?, college_name), college_logo_file_id = COALESCE(?, college_logo_file_id),
           psu_name = COALESCE(?, psu_name), psu_logo_file_id = COALESCE(?, psu_logo_file_id)
       WHERE id = ?`,
      [officeId, orgLogoFileId || null, collegeName || null, collegeLogoFileId || null, psuName || null, psuLogoFileId || null, unclaimed[0].id]
    );
    return unclaimed[0].id;
  }
  const [result] = await pool.query(
    `INSERT INTO student_organizations (name, org_logo_file_id, college_name, college_logo_file_id, psu_name, psu_logo_file_id, office_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, orgLogoFileId || null, collegeName || null, collegeLogoFileId || null, psuName?.trim() || "Pangasinan State University", psuLogoFileId || null, officeId]
  );
  return result.insertId;
}

// Edits the office's own organization. Anything the caller leaves out keeps
// its current value (so saving just the name never wipes the logos); a field
// that IS sent — including an explicit null, which clears a logo — replaces it.
export async function updateOrganizationForOffice(officeId, fields) {
  const org = await getOrganizationByOffice(officeId);
  if (!org) return false;
  const pick = (key, current) => (Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : current);
  return updateOrganization(org.id, {
    name: pick("name", org.name),
    orgLogoFileId: pick("orgLogoFileId", org.org_logo_file_id),
    collegeName: pick("collegeName", org.college_name),
    collegeLogoFileId: pick("collegeLogoFileId", org.college_logo_file_id),
    psuName: pick("psuName", org.psu_name),
    psuLogoFileId: pick("psuLogoFileId", org.psu_logo_file_id),
  });
}

// Constitution & By-Laws (CBL) upload — the original single-file column,
// kept because schema.sql still defines it. New uploads go through the
// general-purpose organization_documents functions below.
export async function updateOrganizationCbl(id, cblFileId) {
  const [result] = await pool.query(
    "UPDATE student_organizations SET cbl_file_id = ? WHERE id = ?",
    [cblFileId || null, id]
  );
  return result.affectedRows > 0;
}

// ── Organization documents (CBL, Resolutions, Orders, etc.) ───────────
// Generalizes the old single-CBL-file card into any number of dated
// documents, each tagged with a type — an org can have its CBL plus
// several Resolutions/Orders on file at once, each viewable/downloadable
// on its own.
// includeHidden: the admin and the owning office see everything; students and
// other offices only ever get what is currently public.
export async function listOrganizationDocuments(organizationId, { includeHidden = true } = {}) {
  const [rows] = await pool.query(
    `SELECT * FROM organization_documents WHERE organization_id = ? ${includeHidden ? "" : "AND hidden = 0"} ORDER BY created_at DESC, id DESC`,
    [organizationId]
  );
  const files = await getFiles(rows.map((r) => r.file_id));
  const fileMap = new Map(files.map((f) => [f.id, f]));
  return rows.map((r) => ({ ...r, file: fileMap.get(r.file_id) || null }));
}

export async function addOrganizationDocument({ organizationId, docType, fileId, title = null, description = null }) {
  const [result] = await pool.query(
    "INSERT INTO organization_documents (organization_id, doc_type, file_id, title, description) VALUES (?, ?, ?, ?, ?)",
    [organizationId, docType, fileId, title, description]
  );
  return result.insertId;
}

export async function updateOrganizationDocument(id, { title, description, fileId }) {
  const [result] = await pool.query(
    "UPDATE organization_documents SET title = ?, description = ?, file_id = COALESCE(?, file_id) WHERE id = ?",
    [title, description || null, fileId || null, id]
  );
  return result.affectedRows > 0;
}

export async function setOrganizationDocumentHidden(id, hidden) {
  const [result] = await pool.query("UPDATE organization_documents SET hidden = ? WHERE id = ?", [hidden ? 1 : 0, id]);
  return result.affectedRows > 0;
}

export async function getOrganizationDocument(id) {
  const [rows] = await pool.query("SELECT * FROM organization_documents WHERE id = ?", [id]);
  return rows[0] || null;
}

export async function deleteOrganizationDocument(id) {
  const [result] = await pool.query("DELETE FROM organization_documents WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

// ── Officers ─────────────────────────────────────────────────────────
export async function listOfficers(organizationId) {
  const [rows] = await pool.query(
    "SELECT * FROM org_officers WHERE organization_id = ? ORDER BY id",
    [organizationId]
  );
  const files = await getFiles(rows.filter((r) => r.photo_file_id).map((r) => r.photo_file_id));
  const fileMap = new Map(files.map((f) => [f.id, f]));
  const hydrated = rows.map((r) => ({ ...r, photo: r.photo_file_id ? fileMap.get(r.photo_file_id) || null : null }));
  const pairs = await getConnectionsForOrg(organizationId);
  return attachConnections(hydrated, pairs);
}

export async function getOfficer(id) {
  const [rows] = await pool.query("SELECT * FROM org_officers WHERE id = ?", [id]);
  return rows[0] || null;
}

export async function createOfficer({ organizationId, name, photoFileId, position, category, parentOfficerId, secondParentOfficerId }) {
  const { first, second } = normalizeParents(parentOfficerId, secondParentOfficerId);
  const [result] = await pool.query(
    `INSERT INTO org_officers (organization_id, name, photo_file_id, position, category, parent_officer_id, second_parent_officer_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, name, photoFileId || null, position, category?.trim() || null, first, second]
  );
  return result.insertId;
}

export async function updateOfficer(id, { name, photoFileId, position, category, parentOfficerId, secondParentOfficerId }) {
  const { first, second } = normalizeParents(parentOfficerId, secondParentOfficerId);
  const [result] = await pool.query(
    `UPDATE org_officers
     SET name = ?, photo_file_id = ?, position = ?, category = ?, parent_officer_id = ?, second_parent_officer_id = ?
     WHERE id = ?`,
    [name, photoFileId || null, position, category?.trim() || null, first, second, id]
  );
  return result.affectedRows > 0;
}

// An officer can have up to TWO positions above them. If only the second
// slot was filled in, it simply becomes the first (so "top position" and
// "one position above" always look the same in the data), and the same
// officer picked twice collapses to one.
function normalizeParents(parentOfficerId, secondParentOfficerId) {
  let first = parentOfficerId ? Number(parentOfficerId) : null;
  let second = secondParentOfficerId ? Number(secondParentOfficerId) : null;
  if (!first && second) {
    first = second;
    second = null;
  }
  if (first && second && first === second) second = null;
  return { first, second };
}

export async function deleteOfficer(id) {
  // Anyone who had the deleted officer as their FIRST position above and still
  // has a second one keeps a proper place in the chart: the second becomes
  // their (only) position above, instead of leaving a dangling second link.
  await pool.query(
    `UPDATE org_officers
     SET parent_officer_id = second_parent_officer_id, second_parent_officer_id = NULL
     WHERE parent_officer_id = ? AND second_parent_officer_id IS NOT NULL`,
    [id]
  );
  const [result] = await pool.query("DELETE FROM org_officers WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

// ── Officer connections ("connected to") ────────────────────────────
// A second, separate kind of link from "position above": a many-to-many,
// undirected relationship that lets one officer connect across multiple
// branches of the chart instead of just sitting under a single position
// above them. Rendered as a dashed line, distinct from the tree's solid
// hierarchy lines, on both the on-screen chart and the PDF export.
export async function getConnectionsForOrg(organizationId) {
  const [rows] = await pool.query(
    `SELECT c.officer_id, c.connected_officer_id
     FROM org_officer_connections c
     JOIN org_officers o ON o.id = c.officer_id
     WHERE o.organization_id = ?`,
    [organizationId]
  );
  return rows;
}

// Attaches connected_officer_ids (deduped, both directions resolved) to
// each officer row in a list.
function attachConnections(officers, pairs) {
  const sets = new Map(officers.map((o) => [o.id, new Set()]));
  for (const { officer_id, connected_officer_id } of pairs) {
    sets.get(officer_id)?.add(connected_officer_id);
    sets.get(connected_officer_id)?.add(officer_id);
  }
  return officers.map((o) => ({ ...o, connected_officer_ids: Array.from(sets.get(o.id) || []) }));
}

// Replaces every "connected to" link involving this officer with the
// given set — called after an officer is created/updated with the full
// desired list, so this is always a full replace, never an incremental
// add. Pairs are normalized (smaller id first) before insert so the same
// undirected link can never end up stored twice in reverse.
export async function setOfficerConnections(officerId, connectedIds) {
  const id = Number(officerId);
  const clean = Array.from(new Set((connectedIds || []).map(Number))).filter((cid) => cid && cid !== id);

  await pool.query("DELETE FROM org_officer_connections WHERE officer_id = ? OR connected_officer_id = ?", [id, id]);
  if (clean.length === 0) return;

  const pairs = Array.from(new Map(clean.map((cid) => [`${Math.min(id, cid)}-${Math.max(id, cid)}`, [Math.min(id, cid), Math.max(id, cid)]])).values());
  await pool.query(
    `INSERT INTO org_officer_connections (officer_id, connected_officer_id) VALUES ${pairs.map(() => "(?, ?)").join(", ")}`,
    pairs.flat()
  );
}
