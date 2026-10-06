import * as repo from "../repositories/documentRepositoryRepo.js";
import { officeExists } from "../repositories/officeRepo.js";
import fs from "node:fs";
import path from "node:path";
import { UPLOAD_DIR } from "../middleware/upload.js";

export async function listFolders(req, res) {
  res.json({ items: await repo.listFolders(null) });
}

export async function createFolder(req, res) {
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Folder name is required." });
  const id = await repo.createFolder(name);
  res.status(201).json({ id, name });
}

export async function deleteFolder(req, res) {
  const ok = await repo.deleteFolder(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Folder not found." });
  res.json({ message: "Folder deleted." });
}

export async function listFiles(req, res) {
  res.json({ items: await repo.listFiles(req.params.folderId) });
}

export async function uploadFile(req, res) {
  if (!req.file) return res.status(400).json({ error: "VALIDATION_ERROR", message: "No file was uploaded." });
  const id = await repo.addFile(req.params.folderId, req.file.originalname, req.file.filename);
  res.status(201).json({ id, name: req.file.originalname, storedAs: req.file.filename });
}

export async function viewFile(req, res) {
  const file = await repo.getFile(req.params.id);
  if (!file || !file.stored_name) return res.status(404).json({ error: "NOT_FOUND", message: "File not found." });
  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "NOT_FOUND", message: "File is missing from storage." });
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.name)}"`);
  res.sendFile(filePath);
}

export async function downloadFile(req, res) {
  const file = await repo.getFile(req.params.id);
  if (!file || !file.stored_name) return res.status(404).json({ error: "NOT_FOUND", message: "File not found." });
  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "NOT_FOUND", message: "File is missing from storage." });
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
  res.sendFile(filePath);
}

export async function archiveFile(req, res) {
  const ok = await repo.setFileStatus(req.params.id, "archived");
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "File not found." });
  res.json({ message: "File archived." });
}

export async function restoreFile(req, res) {
  const ok = await repo.setFileStatus(req.params.id, "active");
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "File not found." });
  res.json({ message: "File restored." });
}

export async function deleteFile(req, res) {
  const ok = await repo.deleteFile(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "File not found." });
  res.json({ message: "File deleted." });
}

// ── Inter-office transmission — authorized offices only (spec section 19) ──
export async function listTransmissions(req, res) {
  res.json({ items: await repo.listTransmissions() });
}

export async function createTransmission(req, res) {
  const { direction, officeId, documentName, notes, fileIds } = req.body || {};
  if (!["sent", "requested"].includes(direction)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Direction must be 'sent' or 'requested'." });
  }
  if (!documentName || !documentName.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Document name is required." });
  }
  if (!officeId || !(await officeExists(officeId))) {
    return res.status(403).json({ error: "UNAUTHORIZED_OFFICE", message: "That office is not in the authorized network." });
  }
  // Only an outbound ("sent") transmission carries a file of its own — a
  // "requested" one is asking the office for a file, so it can't attach one.
  if (direction === "requested" && Array.isArray(fileIds) && fileIds.length > 0) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "A requested document cannot include attachments." });
  }
  const id = await repo.createTransmission({ direction, officeId, documentName: documentName.trim(), notes });
  if (direction === "sent" && Array.isArray(fileIds)) {
    for (const fileId of fileIds) {
      await repo.addTransmissionFile(id, fileId);
    }
  }
  res.status(201).json({ id });
}

export async function updateTransmissionStatus(req, res) {
  const { status } = req.body || {};
  if (!["pending", "acknowledged", "fulfilled"].includes(status)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid status." });
  }
  const ok = await repo.setTransmissionStatus(req.params.id, status);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Transmission not found." });
  res.json({ message: "Status updated." });
}
