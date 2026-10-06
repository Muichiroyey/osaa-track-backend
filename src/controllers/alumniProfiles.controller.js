import * as repo from "../repositories/alumniRepo.js";

export async function list(req, res) {
  const items = await repo.listAlumniProfiles({
    program: req.query.program,
    batchYear: req.query.batchYear,
    employmentStatus: req.query.employmentStatus,
  });
  res.json({ items });
}

export async function create(req, res) {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Name is required." });
  const id = await repo.createAlumniProfile(req.body);
  res.status(201).json({ id });
}

export async function update(req, res) {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Name is required." });
  const ok = await repo.updateAlumniProfile(req.params.id, req.body);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Alumni profile not found." });
  res.json({ message: "Profile updated." });
}

export async function remove(req, res) {
  const ok = await repo.deleteAlumniProfile(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Alumni profile not found." });
  res.json({ message: "Profile deleted." });
}
