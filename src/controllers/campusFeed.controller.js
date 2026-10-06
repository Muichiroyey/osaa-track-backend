import * as repo from "../repositories/campusFeedRepo.js";

export async function list(req, res) {
  res.json({ items: await repo.listPosts() });
}

export async function create(req, res) {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Post content is required." });
  const id = await repo.createPost(req.body);
  res.status(201).json({ id });
}

export async function update(req, res) {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Post content is required." });
  const ok = await repo.updatePost(req.params.id, req.body);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Post not found." });
  res.json({ message: "Post updated." });
}

export async function remove(req, res) {
  const ok = await repo.deletePost(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Post not found." });
  res.json({ message: "Post deleted." });
}
