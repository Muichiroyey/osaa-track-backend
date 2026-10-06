import * as repo from "../repositories/userRepo.js";
import { destroySessionsForUser } from "../middleware/portalAuth.js";

const VALID_TYPES = new Set(["student", "alumni", "staff", "offices"]);
const VALID_STATUSES = new Set(["active", "pending", "inactive"]);

function validate(body, { requirePassword }) {
  if (!body.name || !body.name.trim()) return "Name is required.";
  // Email is the portal login username now, so a student/alumni account
  // without one could never sign in. The admin is told that up front
  // instead of discovering it when the user calls the office.
  if (["student", "alumni", "staff"].includes(body.type) && (!body.email || !body.email.trim())) {
    return "Students, alumni and SAA Staff sign in with their email address, so an email is required for this account type.";
  }
  if (!body.type || !VALID_TYPES.has(body.type)) return "Select a valid access type.";
  if (body.status && !VALID_STATUSES.has(body.status)) return "Invalid status.";
  if (requirePassword && (!body.password || body.password.length < 4)) {
    return "A password of at least 4 characters is required.";
  }
  return null;
}

export async function list(req, res) {
  const items = await repo.listUsers({ search: req.query.search, type: req.query.type, status: req.query.status });
  res.json({ items });
}

export async function create(req, res) {
  const error = validate(req.body, { requirePassword: true });
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });

  if (req.body.code) {
    const exists = await repo.codeExists(req.body.code);
    if (exists) return res.status(409).json({ error: "DUPLICATE_CODE", message: "That ID/code is already in use." });
  }

  try {
    const id = await repo.createUser(req.body);
    const item = await repo.getUser(id);
    res.status(201).json({ item });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "DUPLICATE_EMAIL", message: "That email address already belongs to another account." });
    }
    throw err;
  }
}

export async function update(req, res) {
  const error = validate(req.body, { requirePassword: false });
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });

  let ok;
  try {
    ok = await repo.updateUser(req.params.id, req.body);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "DUPLICATE_EMAIL", message: "That email address already belongs to another account." });
    }
    throw err;
  }
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "User not found." });

  // Changing the password or the account type from here invalidates any
  // portal session that account already has open, so a reset password or a
  // corrected type takes effect immediately instead of at token expiry.
  if (req.body.password || req.body.type) destroySessionsForUser(Number(req.params.id));

  const item = await repo.getUser(req.params.id);
  res.json({ item });
}

export async function verify(req, res) {
  const ok = await repo.updateUserStatus(req.params.id, "active");
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "User not found." });
  res.json({ message: "User verified and activated." });
}

export async function deactivate(req, res) {
  const ok = await repo.updateUserStatus(req.params.id, "inactive");
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "User not found." });
  // Sign the account out of the portal right away rather than letting an
  // already-issued token keep working until it expires.
  destroySessionsForUser(Number(req.params.id));
  res.json({ message: "User deactivated." });
}

export async function activate(req, res) {
  const ok = await repo.updateUserStatus(req.params.id, "active");
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "User not found." });
  res.json({ message: "User activated." });
}

export async function remove(req, res) {
  destroySessionsForUser(Number(req.params.id));
  const ok = await repo.deleteUser(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "User not found." });
  res.json({ message: "User deleted." });
}
