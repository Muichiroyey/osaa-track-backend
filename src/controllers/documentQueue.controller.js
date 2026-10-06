import path from "node:path";
import fs from "node:fs/promises";
import * as repo from "../repositories/documentQueueRepo.js";
import { officeExists, getOffice } from "../repositories/officeRepo.js";
import { getFile } from "../repositories/uploadedFileRepo.js";
import { UPLOAD_DIR } from "../middleware/upload.js";
import { notify } from "../repositories/notificationRepo.js";

// ── E-signatures: PDF and Word (.docx) ONLY ───────────────────────────────
// The sign window already refuses everything else, but the rule is enforced
// here too so it can't be bypassed by calling the API directly. Both the
// document being signed and the signed copy that comes back must be a real
// PDF or .docx — the extension AND the file's own first bytes are checked,
// so renaming a picture to "something.pdf" doesn't get through.
const SIGNABLE_MESSAGE = "E-signatures can only be added to PDF and Word (.docx) documents.";

function extensionOf(name = "") {
  return path.extname(String(name)).replace(".", "").toLowerCase();
}

async function signableKind(file) {
  const ext = extensionOf(file?.original_name);
  if (ext !== "pdf" && ext !== "docx") return null;
  let handle;
  try {
    handle = await fs.open(path.join(UPLOAD_DIR, path.basename(file.stored_name)), "r");
    const buf = Buffer.alloc(4);
    await handle.read(buf, 0, 4, 0);
    if (ext === "pdf" && buf.toString("latin1") === "%PDF") return "pdf";
    if (ext === "docx" && buf[0] === 0x50 && buf[1] === 0x4b) return "docx";
    return null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

// Returns an error response payload, or null when everything is fine.
export async function checkSignable({ sourceFile, signedFileId }) {
  if (sourceFile && !(await signableKind(sourceFile))) {
    return { status: 400, body: { error: "UNSUPPORTED_FILE_TYPE", message: SIGNABLE_MESSAGE } };
  }
  const signed = await getFile(signedFileId);
  if (!signed) return { status: 404, body: { error: "NOT_FOUND", message: "The signed file could not be found." } };
  if (!(await signableKind(signed))) {
    return { status: 400, body: { error: "UNSUPPORTED_FILE_TYPE", message: SIGNABLE_MESSAGE } };
  }
  return null;
}

// The browser describes each signer's signature (which image, where it was
// placed) so that signer can be re-signed later without wiping the others.
// It is optional, but when present it must be well-formed — this is data
// that later gets replayed into a document, so junk is refused up front.
const PDF_KEYS = ["pageIndex", "u", "v", "w", "h"];
const DOCX_KEYS = ["paragraphIndex", "xEmu", "yEmu", "wEmu", "hEmu"];

export async function normalizeLayer(raw) {
  if (!raw) return { layer: null };
  const { signatureFileId, placements, widthPt } = raw;
  if (!Array.isArray(placements) || placements.length === 0 || placements.length > 60) {
    return { error: "The signature placements are missing or invalid." };
  }
  const clean = [];
  for (const p of placements) {
    const keys = PDF_KEYS.every((k) => Number.isFinite(Number(p?.[k]))) ? PDF_KEYS : DOCX_KEYS.every((k) => Number.isFinite(Number(p?.[k]))) ? DOCX_KEYS : null;
    if (!keys) return { error: "The signature placements are missing or invalid." };
    clean.push(Object.fromEntries(keys.map((k) => [k, Number(p[k])])));
  }
  if (signatureFileId) {
    const file = await getFile(signatureFileId);
    if (!file) return { error: "The signature image could not be found." };
  }
  return { layer: { signatureFileId: signatureFileId || null, placements: clean, widthPt: Number(widthPt) || 110 } };
}

export const ALREADY_RELEASED = {
  status: 409,
  body: { error: "ALREADY_RELEASED", message: "This document has already been released to the requester, so it can't be signed any more." },
};

export async function list(req, res) {
  await repo.expireOverdueRevisions();
  const items = await repo.listTickets({ search: req.query.search, tab: req.query.tab });
  res.json({ items });
}

// ── Queuing Archive ───────────────────────────────────────────────────────
export async function archiveCounts(req, res) {
  await repo.expireOverdueRevisions();
  await repo.purgeExpiredArchive();
  const counts = await repo.getArchiveCounts();
  res.json({ counts });
}

const VALID_ARCHIVE_CATEGORIES = ["rejected", "needs_revision", "approved_esign", "approved_physical"];

export async function listArchive(req, res) {
  const { category, search } = req.query;
  if (!VALID_ARCHIVE_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "category must be one of: " + VALID_ARCHIVE_CATEGORIES.join(", ") });
  }
  await repo.expireOverdueRevisions();
  await repo.purgeExpiredArchive();
  const items = await repo.listArchive({ category, search });
  res.json({ items });
}

export async function bulkDeleteArchive(req, res) {
  const { category, ids } = req.body || {};
  if (!VALID_ARCHIVE_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "category must be one of: " + VALID_ARCHIVE_CATEGORIES.join(", ") });
  }
  if (!repo.isManuallyDeletableCategory(category)) {
    return res.status(403).json({
      error: "NOT_MANUALLY_DELETABLE",
      message: "Rejected and Needs Revision documents clear automatically after 30 days and can't be deleted manually.",
    });
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "ids must be a non-empty array." });
  }
  const deleted = await repo.bulkDeleteArchiveTickets(ids, category);
  res.json({ deleted });
}

export async function getOne(req, res) {
  const item = await repo.getTicket(req.params.id);
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  const routes = await repo.listRoutesForTicket(req.params.id);
  res.json({ item, routes });
}

export async function create(req, res) {
  const { requesterName, requesterType, documentType } = req.body || {};
  if (!requesterName || !["student", "alumni", "offices"].includes(requesterType) || !documentType) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "requesterName, requesterType (student/alumni/offices), and documentType are required.",
    });
  }
  const { id, ticketNo } = await repo.createTicket({ requesterName, requesterType, documentType });
  res.status(201).json({ id, ticketNo });
}

// ── "Submit to SAA" (Office Portal, spec section 4 step 2) — the admin
// asks a specific, portal-account-linked office to submit a document.
// Restricted to offices that actually have a login (officeExists alone
// isn't enough — signRoute-style "on behalf of" doesn't apply here since
// there's no admin fallback for filing the request itself; someone has to
// receive it in their own inbox).
export async function requestFromOffice(req, res) {
  const { officeId, documentType, description } = req.body || {};
  const documentTypeTrimmed = (documentType || "").trim();
  if (!officeId || !documentTypeTrimmed) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "officeId and documentType are required." });
  }
  if (!(await officeExists(officeId))) {
    return res.status(403).json({ error: "UNAUTHORIZED_OFFICE", message: "That office is not in the authorized network." });
  }
  const office = await getOffice(officeId);
  if (!office?.user_id) {
    return res.status(409).json({
      error: "OFFICE_HAS_NO_ACCOUNT",
      message: "This office has no Office Portal login account linked yet, so it has nowhere to receive this request.",
    });
  }
  const { id, ticketNo } = await repo.createAdminRequestToOffice({
    officeName: office.name,
    officeUserId: office.user_id,
    documentType: documentTypeTrimmed,
    description: (description || "").trim(),
  });
  await notify({
    userId: office.user_id,
    type: "document_requested",
    title: "SAA requested a document",
    body: `SAA is requesting: ${documentTypeTrimmed} — ticket ${ticketNo}.`,
    linkType: "document-queue-ticket",
    linkId: id,
  });
  res.status(201).json({ id, ticketNo });
}

// Decision (spec section 21) — two approval paths (physical vs
// e-signature) plus reject/revise.
export async function decide(req, res) {
  const { action, remarks } = req.body || {};
  if (!["approve", "approve_esign", "reject", "revise"].includes(action)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "action must be approve, approve_esign, reject, or revise." });
  }
  if (action === "reject" && (!remarks || !remarks.trim())) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Rejection requires administrative remarks." });
  }
  if (action === "revise" && (!remarks || !remarks.trim())) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Revision requests require specific instructions." });
  }
  const ticket = await repo.getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });

  await repo.decideTicket(req.params.id, action, { remarks });
  const updated = await repo.getTicket(req.params.id);

  // Office Portal: let the filing office know their ticket moved, same as
  // the transactional emails already do for student/alumni tickets.
  if (ticket.requester_type === "offices" && ticket.requester_user_id) {
    const labels = {
      approve: "Approved for physical signing",
      approve_esign: "Approved — routing for e-signature",
      reject: "Rejected",
      revise: "Revision requested",
    };
    await notify({
      userId: ticket.requester_user_id,
      type: "ticket_status",
      title: `Ticket ${ticket.ticket_no}: ${labels[action]}`,
      body: remarks ? remarks.trim() : `Your request for ${ticket.document_type} has been updated.`,
      linkType: "document-queue-ticket",
      linkId: ticket.id,
    });
  }
  res.json({ item: updated });
}

export async function resubmit(req, res) {
  const ok = await repo.resubmitTicket(req.params.id);
  if (!ok) {
    return res.status(409).json({
      error: "REVISION_WINDOW_CLOSED",
      message: "This ticket isn't awaiting revision, or its 7-day window has already lapsed.",
    });
  }
  const item = await repo.getTicket(req.params.id);
  res.json({ item });
}

export async function attachFile(req, res) {
  const { fileId } = req.body || {};
  if (!fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "fileId is required." });
  const ticket = await repo.getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  await repo.attachFile(req.params.id, fileId);
  const updated = await repo.getTicket(req.params.id);
  res.json({ item: updated });
}

export async function sign(req, res) {
  const { fileId } = req.body || {};
  if (!fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "fileId is required." });
  const ticket = await repo.getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  if (ticket.confirmed_at) return res.status(ALREADY_RELEASED.status).json(ALREADY_RELEASED.body);
  const sourceFile = await repo.getLatestSignableFile(req.params.id);
  const problem = await checkSignable({ sourceFile, signedFileId: fileId });
  if (problem) return res.status(problem.status).json(problem.body);
  const { layer, error } = await normalizeLayer(req.body.layer);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  await repo.signDocument(req.params.id, fileId, layer);
  const updated = await repo.getTicket(req.params.id);
  res.json({ item: updated });
}

// Everything the browser needs to rebuild the signed copy when ONE signer
// re-signs: the untouched original plus each signer's signature image and
// placements.
export async function signatureLayers(req, res) {
  const ticket = await repo.getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  const layers = await repo.listSignatureLayers(req.params.id);
  res.json({ original: ticket.file || null, layers });
}

// The admin's own final step: locks in their signature and releases the
// document to the requester.
export async function confirmSignature(req, res) {
  const ok = await repo.confirmTicketSignature(req.params.id);
  if (!ok) {
    return res.status(409).json({ error: "NOT_SIGNED", message: "Add your e-signature before confirming." });
  }
  const item = await repo.getTicket(req.params.id);
  res.json({ item });
}

// Which file should currently be loaded into the signature tool — the
// cumulative copy carrying every signature so far (or the original when
// nobody has signed yet). The admin, and later each office, signs on top.
export async function latestFile(req, res) {
  const file = await repo.getLatestSignableFile(req.params.id);
  if (!file) return res.status(404).json({ error: "NOT_FOUND", message: "No document to sign yet." });
  res.json({ file });
}

// ── E-signature routing — offices table is the authorization source of
// truth (spec section 23); routing to anything else is rejected. ────────
export async function route(req, res) {
  const { officeId } = req.body || {};
  const ticket = await repo.getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  if (!officeId || !(await officeExists(officeId))) {
    return res.status(403).json({ error: "UNAUTHORIZED_OFFICE", message: "That office is not in the authorized e-signature network." });
  }
  const id = await repo.routeForSignature(req.params.id, officeId);
  const office = await getOffice(officeId);
  if (office?.user_id) {
    await notify({
      userId: office.user_id,
      type: "esignature_request",
      title: "E-signature requested",
      body: `SAA routed ticket ${ticket.ticket_no} (${ticket.document_type}) to your office for an e-signature.`,
      linkType: "document-queue-route",
      linkId: id,
    });
  }
  res.status(201).json({ id });
}

export async function updateRoute(req, res) {
  const { status } = req.body || {};
  if (!["pending", "signed", "declined"].includes(status)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid status." });
  }
  const ok = await repo.updateRouteStatus(req.params.routeId, status);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Routing record not found." });
  res.json({ message: "Routing status updated." });
}

// Admin adds a signature "on behalf of" the routed office — kept as a
// deliberate override for offices without a portal login, or for SAA to
// finish a signature on an office's behalf when asked to. The Office
// Portal's own signing action (officeDocumentQueue.controller.js) calls
// these exact same repo.signRoute/repo.confirmRoute functions when the
// office does it themselves — same tables, same cumulative document, so
// whichever side signs, both sides see it.
export async function signRoute(req, res) {
  const { fileId } = req.body || {};
  if (!fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "fileId is required." });
  const route = await repo.getRoute(req.params.routeId);
  if (!route) return res.status(404).json({ error: "NOT_FOUND", message: "Routing record not found." });
  const ticket = await repo.getTicket(route.ticket_id);
  if (ticket?.confirmed_at) return res.status(ALREADY_RELEASED.status).json(ALREADY_RELEASED.body);
  if (route.confirmed_at) {
    return res.status(409).json({ error: "ROUTE_ALREADY_CONFIRMED", message: "This office's signature is already confirmed." });
  }
  const sourceFile = await repo.getLatestSignableFile(route.ticket_id);
  const problem = await checkSignable({ sourceFile, signedFileId: fileId });
  if (problem) return res.status(problem.status).json(problem.body);
  const { layer, error } = await normalizeLayer(req.body.layer);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });
  await repo.signRoute(req.params.routeId, fileId, layer);
  res.json({ message: "Signed on behalf of the office." });
}

// The routed office confirms their signature is final — flips the
// admin's view from "Pending" to "Done".
export async function confirmRoute(req, res) {
  const route = await repo.getRoute(req.params.routeId);
  if (!route) return res.status(404).json({ error: "NOT_FOUND", message: "Routing record not found." });
  if (!route.signed_file_id) {
    return res.status(409).json({ error: "NOT_SIGNED", message: "This office hasn't added their signature yet." });
  }
  await repo.confirmRoute(req.params.routeId);
  res.json({ message: "Confirmed." });
}
