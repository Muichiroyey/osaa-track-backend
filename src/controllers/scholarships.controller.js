import * as repo from "../repositories/scholarshipRepo.js";

export async function list(req, res) {
  res.json({ items: await repo.listScholarships() });
}

export async function getOne(req, res) {
  const item = await repo.getScholarship(req.params.id);
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Scholarship not found." });
  const applicants = await repo.listApplicants(req.params.id);
  res.json({ item, applicants });
}

function validate(body) {
  if (!body.name || !body.name.trim()) return "Scholarship name is required.";
  if (!body.provider || !body.provider.trim()) return "Provider is required.";
  return null;
}

export async function create(req, res) {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  const id = await repo.createScholarship(req.body);
  if (Array.isArray(req.body.attachmentFileIds)) await repo.setAttachments(id, req.body.attachmentFileIds);
  const item = await repo.getScholarship(id);
  res.status(201).json({ item });
}

export async function update(req, res) {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  const ok = await repo.updateScholarship(req.params.id, req.body);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Scholarship not found." });
  if (Array.isArray(req.body.attachmentFileIds)) await repo.setAttachments(req.params.id, req.body.attachmentFileIds);
  const item = await repo.getScholarship(req.params.id);
  res.json({ item });
}

export async function close(req, res) {
  const ok = await repo.setScholarshipStatus(req.params.id, "closed");
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Scholarship not found." });
  res.json({ message: "Scholarship closed." });
}

export async function reopen(req, res) {
  const ok = await repo.setScholarshipStatus(req.params.id, "active");
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Scholarship not found." });
  res.json({ message: "Scholarship reactivated." });
}

export async function remove(req, res) {
  const ok = await repo.deleteScholarship(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Scholarship not found." });
  res.json({ message: "Scholarship deleted." });
}

// ── Applicant evaluation ────────────────────────────────────────────────
export async function listApplicants(req, res) {
  res.json({ items: await repo.listApplicants(req.params.id) });
}

export async function createApplicant(req, res) {
  const { studentName } = req.body || {};
  if (!studentName || !studentName.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Student name is required." });
  }
  const id = await repo.createApplicant({ scholarshipId: req.params.id, ...req.body });
  res.status(201).json({ id });
}

export async function addApplicantFile(req, res) {
  const { fileId, label } = req.body || {};
  if (!fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "fileId is required." });
  const id = await repo.addApplicantFile(req.params.applicantId, fileId, label);
  res.status(201).json({ id });
}

export async function decideApplicant(req, res) {
  const { status } = req.body || {};
  if (!["accepted", "rejected"].includes(status)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "status must be accepted or rejected." });
  }
  const ok = await repo.decideApplicant(req.params.applicantId, status);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Applicant not found." });
  if (status === "accepted") {
    await repo.promoteApplicantToRecipient(req.params.applicantId);
  }
  res.json({ message: `Applicant ${status}.` });
}

// ── Recipient roster + historical ingestion ─────────────────────────────
export async function listCategories(req, res) {
  res.json({ items: await repo.listCategories() });
}

export async function createCategory(req, res) {
  const { name, kind } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Category name is required." });
  const id = await repo.createCategory(name.trim(), kind);
  res.status(201).json({ id });
}

export async function listRecipients(req, res) {
  const items = await repo.listRecipients({ scholarshipId: req.query.scholarshipId, categoryId: req.query.categoryId });
  res.json({ items });
}

export async function addRecipient(req, res) {
  const { studentName } = req.body || {};
  if (!studentName || !studentName.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Student name is required." });
  }
  const id = await repo.addManualRecipient(req.body);
  res.status(201).json({ id });
}
