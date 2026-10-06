import * as repo from "../repositories/faqRepo.js";

function validate(body) {
  if (!body.question || !body.question.trim()) return "Question is required.";
  if (!body.answer || !body.answer.trim()) return "Answer is required.";
  return null;
}

export async function list(req, res) {
  res.json({ items: await repo.listFaqs() });
}

export async function create(req, res) {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  const id = await repo.createFaq(req.body);
  res.status(201).json({ id });
}

export async function update(req, res) {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  const ok = await repo.updateFaq(req.params.id, req.body);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "FAQ entry not found." });
  res.json({ message: "FAQ entry updated." });
}

export async function remove(req, res) {
  const ok = await repo.deleteFaq(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "FAQ entry not found." });
  res.json({ message: "FAQ entry deleted." });
}
