import path from "node:path";
import fs from "node:fs";
import { UPLOAD_DIR } from "../middleware/upload.js";
import * as repo from "../repositories/uploadedFileRepo.js";

export async function upload(req, res) {
  if (!req.file) return res.status(400).json({ error: "VALIDATION_ERROR", message: "No file was uploaded." });
  const id = await repo.createFile({
    originalName: req.file.originalname,
    storedName: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    uploadedByUserId: req.portalUser?.id ?? req.staffUser?.id ?? null,
  });
  res.status(201).json({ id, originalName: req.file.originalname, sizeBytes: req.file.size });
}

async function send(req, res, disposition) {
  const file = await repo.getFile(req.params.id);
  if (!file) return res.status(404).json({ error: "NOT_FOUND", message: "File not found." });
  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "NOT_FOUND", message: "File is missing from storage." });
  res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(file.original_name)}"`);
  if (file.mime_type) res.setHeader("Content-Type", file.mime_type);
  res.sendFile(filePath);
}

export const view = (req, res) => send(req, res, "inline");
export const download = (req, res) => send(req, res, "attachment");
