import fs from "node:fs";
import path from "node:path";
import * as repo from "../repositories/documentRepositoryRepo.js";
import { officeExists, getOfficeByUserId } from "../repositories/officeRepo.js";
import { UPLOAD_DIR } from "../middleware/upload.js";
import { notify } from "../repositories/notificationRepo.js";
import { checkAttachableFiles } from "../services/fileOwnership.js";

async function requireOffice(req, res) {
  const office = await getOfficeByUserId(req.portalUser.id);
  if (!office) {
    res.status(403).json({ error: "NO_OFFICE_LINKED", message: "This account isn't linked to an authorized office." });
    return null;
  }
  return office;
}

// Every folder-and-file action below is scoped through document_folders.office_id
// — a folder id that belongs to another office (or to SAA's own repository)
// simply doesn't resolve for this account, same 404 either way.
async function ownFolderOr404(req, res, officeId, folderId) {
  const folder = await repo.getFolder(folderId);
  if (!folder || folder.office_id !== officeId) {
    res.status(404).json({ error: "NOT_FOUND", message: "Folder not found." });
    return null;
  }
  return folder;
}

export async function listFolders(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  res.json({ items: await repo.listFolders(office.id) });
}

export async function createFolder(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Folder name is required." });
  const id = await repo.createFolder(name, office.id);
  res.status(201).json({ id, name });
}

export async function deleteFolder(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  if (!(await ownFolderOr404(req, res, office.id, req.params.id))) return;
  await repo.deleteFolder(req.params.id);
  res.json({ message: "Folder deleted." });
}

export async function listFiles(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  if (!(await ownFolderOr404(req, res, office.id, req.params.folderId))) return;
  res.json({ items: await repo.listFiles(req.params.folderId) });
}

export async function uploadFile(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  if (!(await ownFolderOr404(req, res, office.id, req.params.folderId))) return;
  if (!req.file) return res.status(400).json({ error: "VALIDATION_ERROR", message: "No file was uploaded." });
  const id = await repo.addFile(req.params.folderId, req.file.originalname, req.file.filename);
  res.status(201).json({ id, name: req.file.originalname, storedAs: req.file.filename });
}

async function ownFileOr404(req, res, officeId, fileId) {
  const file = await repo.getFile(fileId);
  if (!file) {
    res.status(404).json({ error: "NOT_FOUND", message: "File not found." });
    return null;
  }
  if (!(await ownFolderOr404(req, res, officeId, file.folder_id))) return null;
  return file;
}

export async function viewFile(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const file = await ownFileOr404(req, res, office.id, req.params.id);
  if (!file || !file.stored_name) return;
  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "NOT_FOUND", message: "File is missing from storage." });
  res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(file.name)}"`);
  res.sendFile(filePath);
}

export async function downloadFile(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const file = await ownFileOr404(req, res, office.id, req.params.id);
  if (!file || !file.stored_name) return;
  const filePath = path.join(UPLOAD_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "NOT_FOUND", message: "File is missing from storage." });
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
  res.sendFile(filePath);
}

export async function deleteFile(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  if (!(await ownFileOr404(req, res, office.id, req.params.id))) return;
  await repo.deleteFile(req.params.id);
  res.json({ message: "File deleted." });
}

// ── Inter-office transmission (spec section 6 step 8, "Inter-Office
// Forwarding") — same mechanism the Admin Panel uses, this office as the
// initiator (from_office_id) against another authorized office. ─────────
export async function listTransmissions(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  res.json({ items: await repo.listTransmissionsForOffice(office.id) });
}

export async function createTransmission(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const { direction, officeId, documentName, notes, fileIds } = req.body || {};
  if (!["sent", "requested"].includes(direction)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Direction must be 'sent' or 'requested'." });
  }
  if (!documentName?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Document name is required." });
  }
  // "saa" = the SAA office itself, which isn't a row in `offices`.
  const toSaa = officeId === "saa";
  if (!toSaa && (!officeId || !(await officeExists(officeId)))) {
    return res.status(403).json({ error: "UNAUTHORIZED_OFFICE", message: "That office is not in the authorized network." });
  }
  if (!toSaa && Number(officeId) === office.id) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Select a different office to send to or request from." });
  }
  if (direction === "requested" && Array.isArray(fileIds) && fileIds.length > 0) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "A requested document cannot include attachments." });
  }
  if (direction === "sent" && Array.isArray(fileIds) && fileIds.length > 0) {
    const problem = await checkAttachableFiles(fileIds, req.portalUser.id);
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
  }

  const id = await repo.createTransmission({
    direction,
    officeId: toSaa ? null : officeId,
    fromOfficeId: office.id,
    documentName: documentName.trim(),
    notes,
  });
  if (direction === "sent" && Array.isArray(fileIds)) {
    for (const fileId of fileIds) await repo.addTransmissionFile(id, fileId);
  }

  const counterpart = toSaa ? null : await import("../repositories/officeRepo.js").then((m) => m.getOffice(officeId));
  if (counterpart?.user_id) {
    await notify({
      userId: counterpart.user_id,
      type: "document_transmission",
      title: direction === "sent" ? "Document received" : "Document requested",
      body: `${office.name} ${direction === "sent" ? "sent" : "is requesting"}: ${documentName.trim()}.`,
      linkType: "document-repository-transmission",
      linkId: id,
    });
  }
  res.status(201).json({ id });
}

// Answer a request another office (or SAA) made of this office: upload the
// file that was asked for and send it back to the requester.
export async function respondToTransmission(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const transmission = await repo.getTransmission(req.params.id);
  if (!transmission || transmission.office_id !== office.id) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Request not found." });
  }
  if (transmission.direction !== "requested") {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Only a document request can be answered with a file." });
  }
  const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds : [];
  if (fileIds.length === 0) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Upload the requested file before sending." });
  }
  const problem = await checkAttachableFiles(fileIds, req.portalUser.id);
  if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
  await repo.respondToTransmission(transmission.id, fileIds);

  if (transmission.from_office_id) {
    const requester = await import("../repositories/officeRepo.js").then((m) => m.getOffice(transmission.from_office_id));
    if (requester?.user_id) {
      await notify({
        userId: requester.user_id,
        type: "document_transmission",
        title: "Requested document received",
        body: `${office.name} sent: ${transmission.document_name}.`,
        linkType: "document-repository-transmission",
        linkId: transmission.id,
      });
    }
  }
  res.json({ message: "Document sent to the requester." });
}

export async function updateTransmissionStatus(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const { status } = req.body || {};
  if (!["pending", "acknowledged", "fulfilled"].includes(status)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid status." });
  }
  const transmission = await repo.getTransmission(req.params.id);
  if (!transmission || (transmission.office_id !== office.id && transmission.from_office_id !== office.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Transmission not found." });
  }
  await repo.setTransmissionStatus(req.params.id, status);
  res.json({ message: "Status updated." });
}
