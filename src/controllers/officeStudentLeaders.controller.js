import * as repo from "../repositories/studentLeadersRepo.js";
import { getOfficeByUserId } from "../repositories/officeRepo.js";
import { validateOfficer, validateParents, validateConnectionIds } from "./studentLeaders.controller.js";
import { checkAttachableFiles } from "../services/fileOwnership.js";

const LOGO_KEYS = ["orgLogoFileId", "collegeLogoFileId", "psuLogoFileId"];

// The three branding logos (Org / College / PSU) an office can set for its
// own organization. They have to be images the office uploaded itself — or
// logos already on the organization, so re-saving the form unchanged works.
async function logoProblem(req, currentOrg) {
  const ids = LOGO_KEYS.map((k) => req.body?.[k]).filter(Boolean);
  const keep = currentOrg ? [currentOrg.org_logo_file_id, currentOrg.college_logo_file_id, currentOrg.psu_logo_file_id] : [];
  return checkAttachableFiles(ids, req.portalUser.id, { alreadyOwned: keep, imagesOnly: true });
}

async function requireOffice(req, res) {
  const office = await getOfficeByUserId(req.portalUser.id);
  if (!office) {
    res.status(403).json({ error: "NO_OFFICE_LINKED", message: "This account isn't linked to an authorized office." });
    return null;
  }
  return office;
}

// Viewing every organization (spec step 7 "VIEW OTHER ORGANIZATIONS") and
// downloading a specific one's details/chart is identical to the
// Student/Alumni Portal's read-only version and is wired directly from
// studentLeaders.controller.js in office.routes.js. This file is only the
// office's management of its own single organization.

// "Step 3 – Check Office Organization" — null means this office hasn't
// registered/claimed one yet.
export async function getMyOrganization(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  res.json({ item: await repo.getOrganizationByOffice(office.id) });
}

export async function claimOrCreateOrganization(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Organization name is required." });
  const logoIssue = await logoProblem(req, null);
  if (logoIssue) return res.status(400).json({ error: "VALIDATION_ERROR", message: logoIssue });
  try {
    const id = await repo.claimOrCreateOrganizationForOffice(office.id, { ...req.body, name });
    res.status(201).json({ id, item: await repo.getOrganizationByOffice(office.id) });
  } catch (err) {
    if (err.code === "ALREADY_REGISTERED") {
      // "Enforce One-Organization Rule" (spec step 5) — this is the
      // system doing exactly what the spec says: prevent a second one.
      return res.status(409).json({ error: "ALREADY_REGISTERED", message: err.message });
    }
    throw err;
  }
}

async function ownOrgOr404(req, res, officeId) {
  const org = await repo.getOrganizationByOffice(officeId);
  if (!org) {
    res.status(404).json({ error: "NOT_FOUND", message: "Your office hasn't registered an organization yet." });
    return null;
  }
  return org;
}

export async function updateMyOrganization(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const org = await ownOrgOr404(req, res, office.id);
  if (!org) return;
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Organization name is required." });
  const logoIssue = await logoProblem(req, org);
  if (logoIssue) return res.status(400).json({ error: "VALIDATION_ERROR", message: logoIssue });
  await repo.updateOrganizationForOffice(office.id, { ...req.body, name });
  res.json({ item: await repo.getOrganizationByOffice(office.id) });
}

export async function updateMyOrganizationCbl(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const org = await ownOrgOr404(req, res, office.id);
  if (!org) return;
  await repo.updateOrganizationCbl(org.id, req.body?.cblFileId ?? null);
  res.json({ message: "CBL document updated." });
}

// ── Officers of this office's own organization ──────────────────────────
export async function listMyOfficers(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const org = await ownOrgOr404(req, res, office.id);
  if (!org) return;
  res.json({ items: await repo.listOfficers(org.id) });
}

export async function createOfficer(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const org = await ownOrgOr404(req, res, office.id);
  if (!org) return;
  const error = validateOfficer(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  const { parentOfficerId, secondParentOfficerId, connectedOfficerIds } = req.body;
  const parentProblem = await validateParents(null, org.id, parentOfficerId, secondParentOfficerId);
  if (parentProblem) return res.status(400).json({ error: "VALIDATION_ERROR", message: parentProblem });
  if (Array.isArray(connectedOfficerIds) && connectedOfficerIds.length > 0) {
    const problem = await validateConnectionIds(org.id, connectedOfficerIds);
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
  }
  const id = await repo.createOfficer({ ...req.body, organizationId: org.id });
  await repo.setOfficerConnections(id, connectedOfficerIds || []);
  res.status(201).json({ id });
}

async function ownOfficerOr404(req, res, officeId, officerId) {
  const officer = await repo.getOfficer(officerId);
  const org = await repo.getOrganizationByOffice(officeId);
  if (!officer || !org || officer.organization_id !== org.id) {
    res.status(404).json({ error: "NOT_FOUND", message: "Officer not found in your organization." });
    return null;
  }
  return officer;
}

export async function updateOfficer(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const officer = await ownOfficerOr404(req, res, office.id, req.params.id);
  if (!officer) return;
  const error = validateOfficer(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  const { parentOfficerId, secondParentOfficerId, connectedOfficerIds } = req.body;
  const parentProblem = await validateParents(officer.id, officer.organization_id, parentOfficerId, secondParentOfficerId);
  if (parentProblem) return res.status(400).json({ error: "VALIDATION_ERROR", message: parentProblem });
  if (Array.isArray(connectedOfficerIds) && connectedOfficerIds.length > 0) {
    const problem = await validateConnectionIds(officer.organization_id, connectedOfficerIds, officer.id);
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
  }
  await repo.updateOfficer(req.params.id, req.body);
  await repo.setOfficerConnections(officer.id, connectedOfficerIds || []);
  res.json({ message: "Officer updated." });
}

export async function deleteOfficer(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  if (!(await ownOfficerOr404(req, res, office.id, req.params.id))) return;
  await repo.deleteOfficer(req.params.id);
  res.json({ message: "Officer deleted. Any positions under it move to the top level." });
}

// ── Public documents of this office's own organization ──────────────────
// Posted with a title and description, visible (view + download) to students
// and to other offices unless hidden. The owner can edit, hide and delete.
const DOC_TYPES = ["Constitution & By-Laws", "Resolution", "Order", "Other"];

async function ownDocumentOr404(req, res, org) {
  const doc = await repo.getOrganizationDocument(req.params.id);
  if (!doc || doc.organization_id !== org.id) {
    res.status(404).json({ error: "NOT_FOUND", message: "Document not found in your organization." });
    return null;
  }
  return doc;
}

export async function listMyDocuments(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const org = await ownOrgOr404(req, res, office.id);
  if (!org) return;
  res.json({ items: await repo.listOrganizationDocuments(org.id), docTypes: DOC_TYPES });
}

export async function addMyDocument(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const org = await ownOrgOr404(req, res, office.id);
  if (!org) return;
  const title = (req.body?.title || "").trim();
  const description = (req.body?.description || "").trim();
  const docType = DOC_TYPES.includes(req.body?.docType) ? req.body.docType : "Other";
  if (!title) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Add a title for the document." });
  if (!description) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Add a short description for the document." });
  if (!req.body?.fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Upload the document file." });
  const problem = await checkAttachableFiles([req.body.fileId], req.portalUser.id);
  if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
  const id = await repo.addOrganizationDocument({ organizationId: org.id, docType, fileId: req.body.fileId, title, description });
  res.status(201).json({ id });
}

export async function updateMyDocument(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const org = await ownOrgOr404(req, res, office.id);
  if (!org) return;
  const doc = await ownDocumentOr404(req, res, org);
  if (!doc) return;
  const title = (req.body?.title || "").trim();
  const description = (req.body?.description || "").trim();
  if (!title) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Add a title for the document." });
  if (!description) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Add a short description for the document." });
  let fileId = null;
  if (req.body?.fileId && Number(req.body.fileId) !== doc.file_id) {
    const problem = await checkAttachableFiles([req.body.fileId], req.portalUser.id);
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
    fileId = req.body.fileId;
  }
  await repo.updateOrganizationDocument(doc.id, { title, description, fileId });
  res.json({ message: "Document updated." });
}

export async function setMyDocumentHidden(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const org = await ownOrgOr404(req, res, office.id);
  if (!org) return;
  const doc = await ownDocumentOr404(req, res, org);
  if (!doc) return;
  await repo.setOrganizationDocumentHidden(doc.id, Boolean(req.body?.hidden));
  res.json({ message: req.body?.hidden ? "Document hidden from public view." : "Document is public again." });
}

export async function deleteMyDocument(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const org = await ownOrgOr404(req, res, office.id);
  if (!org) return;
  const doc = await ownDocumentOr404(req, res, org);
  if (!doc) return;
  await repo.deleteOrganizationDocument(doc.id);
  res.json({ message: "Document deleted." });
}

// What everyone else sees of any organization: hidden documents excluded.
export async function listPublicDocuments(req, res) {
  if (!(await repo.organizationExists(req.params.id))) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  }
  res.json({ items: await repo.listOrganizationDocuments(req.params.id, { includeHidden: false }), docTypes: DOC_TYPES });
}
