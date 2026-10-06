import * as repo from "../repositories/studentLeadersRepo.js";
import { buildOrgChartPdf } from "../services/orgChartPdf.js";

// ── Organizations ────────────────────────────────────────────────────
function validateOrganization(body) {
  if (!body.name || !body.name.trim()) return "Organization name is required.";
  return null;
}

export async function listOrganizations(req, res) {
  res.json({ items: await repo.listOrganizations() });
}

export async function getOrganization(req, res) {
  const org = await repo.getOrganization(req.params.id);
  if (!org) return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  res.json(org);
}

export async function createOrganization(req, res) {
  const error = validateOrganization(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  const id = await repo.createOrganization(req.body);
  res.status(201).json({ id });
}

export async function updateOrganization(req, res) {
  const error = validateOrganization(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  const ok = await repo.updateOrganization(req.params.id, req.body);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  res.json({ message: "Organization updated." });
}

export async function deleteOrganization(req, res) {
  const ok = await repo.deleteOrganization(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  res.json({ message: "Organization deleted." });
}

// Constitution & By-Laws — uploaded separately from the org edit form.
// Body: { cblFileId } (an id returned by POST /api/uploads), or
// { cblFileId: null } to remove the current file.
export async function updateOrganizationCbl(req, res) {
  const ok = await repo.updateOrganizationCbl(req.params.id, req.body.cblFileId);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  res.json({ message: "CBL document updated." });
}

// ── Organization documents (CBL, Resolutions, Orders, etc.) ───────────
const DOC_TYPES = ["Constitution & By-Laws", "Resolution", "Order", "Other"];

export async function listOrganizationDocuments(req, res) {
  if (!(await repo.organizationExists(req.params.id))) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  }
  res.json({ items: await repo.listOrganizationDocuments(req.params.id), docTypes: DOC_TYPES });
}

export async function addOrganizationDocument(req, res) {
  const { id } = req.params;
  if (!(await repo.organizationExists(id))) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  }
  const { docType, fileId } = req.body;
  if (!docType || !String(docType).trim()) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Document type is required." });
  if (!fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "A file is required." });
  const docId = await repo.addOrganizationDocument({ organizationId: id, docType: String(docType).trim(), fileId });
  res.status(201).json({ id: docId });
}

export async function deleteOrganizationDocument(req, res) {
  const ok = await repo.deleteOrganizationDocument(req.params.docId);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Document not found." });
  res.json({ message: "Document removed." });
}

// ── Organizational Chart PDF export ───────────────────────────────────
export async function downloadOrgChartPdf(req, res) {
  const org = await repo.getOrganization(req.params.id);
  if (!org) return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  const officers = await repo.listOfficers(req.params.id);

  const safeName = org.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "organization";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}-organizational-chart.pdf"`);
  await buildOrgChartPdf(
    {
      orgName: org.name,
      collegeName: org.college_name,
      officers,
      generatedBy: req.admin?.username,
    },
    res
  );
}

// ── Officers ─────────────────────────────────────────────────────────
export function validateOfficer(body) {
  if (!body.name || !body.name.trim()) return "Officer name is required.";
  if (!body.position || !body.position.trim()) return "Position is required.";
  return null;
}

// Checks a proposed "position above" for one officer. Every position above
// has to be a real officer of THIS organization, and it must not create a
// loop. Because an officer can now have two positions above them, the
// hierarchy is no longer a single chain — so the loop check follows BOTH
// "above" links of every officer it passes through (i.e. it asks: is the
// officer being edited already somewhere above the proposed position?).
async function findCycleOrCrossOrg(officerId, parentOfficerId, organizationId) {
  const seen = new Set();
  const stack = [parentOfficerId];
  while (stack.length > 0) {
    const currentId = stack.pop();
    if (officerId && String(currentId) === String(officerId)) return "cycle";
    if (seen.has(String(currentId))) continue;
    seen.add(String(currentId));
    const node = await repo.getOfficer(currentId);
    if (!node) return "missing";
    if (String(node.organization_id) !== String(organizationId)) return "cross-org";
    if (node.parent_officer_id) stack.push(node.parent_officer_id);
    if (node.second_parent_officer_id) stack.push(node.second_parent_officer_id);
  }
  return null;
}

// Validates both "position above" slots. Returns an error message or null.
export async function validateParents(officerId, organizationId, parentOfficerId, secondParentOfficerId) {
  if (parentOfficerId && secondParentOfficerId && String(parentOfficerId) === String(secondParentOfficerId)) {
    return "Pick two different positions above, or leave the second one empty.";
  }
  for (const candidate of [parentOfficerId, secondParentOfficerId]) {
    if (!candidate) continue;
    const problem = await findCycleOrCrossOrg(officerId, candidate, organizationId);
    if (problem === "cycle") return "That would put this position above itself in the chart.";
    if (problem) return "The selected position above must belong to this same organization.";
  }
  return null;
}

// "Connected to" has none of the tree structure of "position above" — no
// cycle to worry about, since it's a lateral link, not a parent/child
// one — it just needs every id to be a real officer in this same org.
export async function validateConnectionIds(organizationId, ids, excludeId = null) {
  for (const rawId of ids) {
    if (excludeId && String(rawId) === String(excludeId)) return "An officer can't be connected to themselves.";
    const node = await repo.getOfficer(rawId);
    if (!node) return "One of the selected \"connected to\" officers no longer exists.";
    if (String(node.organization_id) !== String(organizationId)) return "\"Connected to\" officers must belong to this same organization.";
  }
  return null;
}

export async function listOfficers(req, res) {
  if (!(await repo.organizationExists(req.params.orgId))) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  }
  res.json({ items: await repo.listOfficers(req.params.orgId) });
}

export async function createOfficer(req, res) {
  const { orgId } = req.params;
  if (!(await repo.organizationExists(orgId))) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });
  }
  const error = validateOfficer(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  const { parentOfficerId, secondParentOfficerId, connectedOfficerIds } = req.body;
  const parentProblem = await validateParents(null, orgId, parentOfficerId, secondParentOfficerId);
  if (parentProblem) return res.status(400).json({ error: "VALIDATION_ERROR", message: parentProblem });
  if (Array.isArray(connectedOfficerIds) && connectedOfficerIds.length > 0) {
    const problem = await validateConnectionIds(orgId, connectedOfficerIds);
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
  }
  const id = await repo.createOfficer({ ...req.body, organizationId: orgId });
  await repo.setOfficerConnections(id, connectedOfficerIds || []);
  res.status(201).json({ id });
}

export async function updateOfficer(req, res) {
  const officer = await repo.getOfficer(req.params.id);
  if (!officer) return res.status(404).json({ error: "NOT_FOUND", message: "Officer not found." });
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
  const ok = await repo.deleteOfficer(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Officer not found." });
  res.json({ message: "Officer deleted. Any positions under it move to the top level." });
}
