import * as repo from "../repositories/documentQueueRepo.js";
import { getSettingInt } from "../repositories/settingsRepo.js";
import { getFile } from "../repositories/uploadedFileRepo.js";
import { pool } from "../config/db.js";

/**
 * DOCUMENT QUEUE — REQUESTER SIDE
 * ───────────────────────────────────────────────────────────────────────
 * The same document_queue_tickets rows the Admin Panel's Document Queue
 * reads. A submission here appears in the admin's "Queuing" tab as a
 * normal pending ticket; the admin's decision is what this side reports
 * back. Nothing about the decision itself happens here — a requester can
 * only create a ticket, re-upload during a revision window, and read
 * their own status.
 *
 * Every query is scoped by requester_user_id in SQL (not filtered after
 * the fact), so a requester cannot reach another person's ticket even by
 * putting its id straight in the URL.
 */

// What the requester is told to do next, derived from the ticket's status.
// This is the piece the admin panel's README always described as "what a
// future student portal will read" — the physical-signing status and its
// remarks only mean something once there's someone to show them to.
export function requesterGuidance(ticket) {
  switch (ticket.status) {
    case "awaiting_submission":
      return {
        label: "Action needed — upload requested document",
        detail: "SAA is requesting this document from your office. Attach the file below to submit it.",
        tone: "warning",
      };
    case "pending":
      return {
        label: "Waiting for SAA review",
        detail: "Your soft copy is in the queue. You'll see the result here — nothing to print yet.",
        tone: "warning",
      };
    case "revision_requested":
      return {
        label: "Revision requested",
        detail: "Read the SAA's remarks, correct your file, and re-upload it to this same ticket before the deadline.",
        tone: "warning",
      };
    case "expired":
      return {
        label: "Revision window closed",
        detail: "This ticket expired without a corrected copy. Submit a new request if you still need the document.",
        tone: "danger",
      };
    case "rejected":
      return {
        label: "Rejected",
        detail: "This request did not meet the requirements. The SAA's remarks explain why.",
        tone: "danger",
      };
    case "approved_for_signing":
      return {
        label: "Approved — physical signing",
        detail: "Print your verified copy and bring it to the SAA office for the ink signature.",
        tone: "success",
      };
    case "approved_for_esigning":
      return ticket.confirmed_at
        ? {
            label: "Signed and released",
            detail: "All signatures are complete. Download the final signed copy below — no printing or office visit needed.",
            tone: "success",
          }
        : {
            label: "Approved — e-signature in progress",
            detail: "The SAA and any routed offices are signing electronically. The final copy appears here once it's confirmed.",
            tone: "info",
          };
    default:
      return { label: ticket.status, detail: "", tone: "neutral" };
  }
}

export async function list(req, res) {
  await repo.expireOverdueRevisions();
  const items = await repo.listTicketsForUser(req.portalUser.id, { search: req.query.search });
  const revisionDays = await getSettingInt("documentQueueRevisionDays", 7);
  res.json({
    items: items.map((t) => ({ ...t, guidance: requesterGuidance(t) })),
    counts: await repo.getTicketCountsForUser(req.portalUser.id),
    revisionDays,
  });
}

export async function getOne(req, res) {
  await repo.expireOverdueRevisions();
  const ticket = await repo.getTicketForUser(req.params.id, req.portalUser.id);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });

  // Routing progress, trimmed to what the requester is entitled to see:
  // which office and whether that stage is done. The office's login
  // username (which the admin's own view shows) is not exposed here.
  const [routeRows] = await pool.query(
    `SELECT r.id, r.status, r.confirmed_at, r.created_at, o.name AS office_name, o.category AS office_category
     FROM esignature_routes r JOIN offices o ON o.id = r.office_id
     WHERE r.ticket_id = ? ORDER BY r.created_at ASC`,
    [ticket.id]
  );
  const routes = routeRows.map((r) => ({
    id: r.id,
    officeName: r.office_name,
    officeCategory: r.office_category,
    stage: r.confirmed_at ? "Signed" : "Pending",
    createdAt: r.created_at,
  }));

  res.json({ item: { ...ticket, guidance: requesterGuidance(ticket) }, routes });
}

/**
 * Submit a document request. The requester's identity comes from their
 * session, never from the request body — a student can't file a ticket
 * under someone else's name, and requester_type always matches the account
 * type the admin assigned.
 */
export async function create(req, res) {
  const documentType = (req.body?.documentType || "").trim();
  const description = (req.body?.description || "").trim();
  const fileId = req.body?.fileId;

  if (!documentType) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Tell us which document you're requesting." });
  }
  if (!fileId) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Upload the soft copy of your document — that's what the SAA reviews before anything is printed.",
    });
  }
  const file = await getFile(fileId);
  if (!file) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "That upload could not be found. Please attach the file again." });
  }

  const { id, ticketNo } = await repo.createTicket({
    requesterName: req.portalUser.name,
    requesterType: req.portalUser.type,
    requesterUserId: req.portalUser.id,
    documentType,
    description,
    fileId,
  });

  const item = await repo.getTicketForUser(id, req.portalUser.id);
  res.status(201).json({ item: { ...item, guidance: requesterGuidance(item) }, ticketNo });
}

/**
 * The revision loop: re-upload the corrected soft copy to the SAME ticket
 * number and send it back to the admin's Queuing tab. Both halves are
 * scoped to the owner and to a ticket genuinely still inside its window,
 * so this can't be used to swap a file on an already-decided ticket.
 */
export async function resubmit(req, res) {
  const { fileId } = req.body || {};
  if (!fileId) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Attach your corrected file before resubmitting." });
  }
  const file = await getFile(fileId);
  if (!file) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "That upload could not be found. Please attach the file again." });
  }

  await repo.expireOverdueRevisions();

  const replaced = await repo.replaceTicketFileForUser(req.params.id, req.portalUser.id, fileId);
  if (!replaced) {
    return res.status(409).json({
      error: "REVISION_WINDOW_CLOSED",
      message: "This ticket isn't awaiting a revision, or its compliance window has already closed.",
    });
  }
  await repo.resubmitTicketForUser(req.params.id, req.portalUser.id);

  const item = await repo.getTicketForUser(req.params.id, req.portalUser.id);
  res.json({ item: { ...item, guidance: requesterGuidance(item) } });
}

/**
 * Which file the requester may download for this ticket. The signed copy
 * is released only once the admin has confirmed the e-signature; before
 * that, the requester gets their own submitted copy back and nothing else.
 */
export async function downloadable(req, res) {
  const ticket = await repo.getTicketForUser(req.params.id, req.portalUser.id);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  res.json({
    submitted: ticket.file || null,
    signed: ticket.signedFile || null,
    signedReleased: Boolean(ticket.confirmed_at && ticket.signed_file_id),
  });
}
