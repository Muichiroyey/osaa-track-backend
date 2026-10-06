import * as repo from "../repositories/jobPostingRepo.js";

function validate(body) {
  if (!body.title || !body.title.trim()) return "Job title is required.";
  if (!body.company || !body.company.trim()) return "Company name is required.";
  return null;
}

export async function list(req, res) {
  res.json({ items: await repo.listJobPostings() });
}

export async function create(req, res) {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  const id = await repo.createJobPosting(req.body);
  res.status(201).json({ id });
}

export async function update(req, res) {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  const ok = await repo.updateJobPosting(req.params.id, req.body);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Job posting not found." });
  res.json({ message: "Job posting updated." });
}

export async function setStatus(req, res) {
  const { status } = req.body || {};
  if (!["active", "inactive"].includes(status)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid status." });
  }
  const ok = await repo.setJobPostingStatus(req.params.id, status);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Job posting not found." });
  res.json({ message: "Status updated." });
}

export async function remove(req, res) {
  const ok = await repo.deleteJobPosting(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Job posting not found." });
  res.json({ message: "Job posting deleted." });
}
