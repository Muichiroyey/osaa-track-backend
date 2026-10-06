import * as repo from "../repositories/documentQueueRepo.js";
import { getFile } from "../repositories/uploadedFileRepo.js";
import { getOfficeByUserId } from "../repositories/officeRepo.js";
import { checkSignable, normalizeLayer, ALREADY_RELEASED } from "./documentQueue.controller.js";
import { pool } from "../config/db.js";

/**
 * DOCUMENT QUEUE — OFFICE PORTAL (spec section 4)
 * ───────────────────────────────────────────────────────────────────────
 * Two things share this controller and the same document_queue_tickets
 * rows the Admin Panel and the Student/Alumni Portal already use:
 *
 *  1. The office's OWN queue of tickets (list/getOne/create/resubmit/
 *     downloadable/fulfillRequested below) — both directions of spec step
 *     2 ("Request from SAA" the office files itself, and "Submit to SAA"
 *     the admin files against them) live in the exact same
 *     requester_user_id-scoped rows, so one list serves both; the
 *     difference is only which status a given ticket starts in.
 *
 *  2. The office's e-signature INBOX (listRoutes/signRoute/confirmRoute/
 *     latestFileForRoute/signatureLayersForRoute below) — tickets OTHER
 *     accounts filed, that got routed to THIS office for a signature
 *     (spec steps 9-17). These reuse the identical repo.signRoute /
 *     repo.confirmRoute functions the admin's "sign on behalf of" action
 *     already calls — same tables, same cumulative document — so
 *     whichever side actually signs, both sides see the result.
 */

async function requireOffice(req, res) {
  const office = await getOfficeByUserId(req.portalUser.id);
  if (!office) {
    res.status(403).json({ error: "NO_OFFICE_LINKED", message: "This account isn't linked to an authorized office." });
    return null;
  }
  return office;
}

function requesterGuidance(ticket) {
  switch (ticket.status) {
    case "awaiting_submission":
      return {
        label: "Action needed — upload requested document",
        detail: "SAA is requesting this document from your office. Attach the file to submit it.",
        tone: "warning",
      };
    case "pending":
      return { label: "Waiting for SAA review", detail: "Your submission is in the queue.", tone: "warning" };
    case "revision_requested":
      return {
        label: "Revision requested",
        detail: "Read SAA's remarks, correct the file, and re-upload it to this same ticket before the deadline.",
        tone: "warning",
      };
    case "expired":
      return { label: "Revision window closed", detail: "This ticket expired without a corrected copy.", tone: "danger" };
    case "rejected":
      return { label: "Rejected", detail: "This request did not meet the requirements — see SAA's remarks.", tone: "danger" };
    case "approved_for_signing":
      return { label: "Approved — physical signing", detail: "Bring your verified copy to the SAA office for the ink signature.", tone: "success" };
    case "approved_for_esigning":
      return ticket.confirmed_at
        ? { label: "Signed and released", detail: "All signatures are complete. Download the final signed copy below.", tone: "success" }
        : { label: "Approved — e-signature in progress", detail: "The final copy appears here once every signature is confirmed.", tone: "info" };
    default:
      return { label: ticket.status, detail: "", tone: "neutral" };
  }
}

// ── The office's own queue (both "Request from SAA" and "Submit to SAA") ──
export async function list(req, res) {
  await repo.expireOverdueRevisions();
  const items = await repo.listTicketsForUser(req.portalUser.id, { search: req.query.search });
  res.json({ items: items.map((t) => ({ ...t, guidance: requesterGuidance(t) })), counts: await repo.getTicketCountsForUser(req.portalUser.id) });
}

export async function getOne(req, res) {
  await repo.expireOverdueRevisions();
  const ticket = await repo.getTicketForUser(req.params.id, req.portalUser.id);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });

  // Routing progress on THIS office's own ticket (e.g. a ticket it filed
  // that then got routed to yet another office to co-sign) — same trimmed
  // shape the Student/Alumni Portal exposes to a requester.
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

// "Request from SAA" (spec section 4 step 2) — the office filing its own
// request, exactly the way a student or alumni does.
export async function create(req, res) {
  const documentType = (req.body?.documentType || "").trim();
  const description = (req.body?.description || "").trim();
  const fileId = req.body?.fileId;
  if (!documentType) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Tell us which document your office needs." });
  if (!fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Attach the soft copy your office is requesting review of." });
  if (!(await getFile(fileId))) return res.status(400).json({ error: "VALIDATION_ERROR", message: "That upload could not be found." });

  const { id, ticketNo } = await repo.createTicket({
    requesterName: req.portalUser.name,
    requesterType: "offices",
    requesterUserId: req.portalUser.id,
    documentType,
    description,
    fileId,
  });
  const item = await repo.getTicketForUser(id, req.portalUser.id);
  res.status(201).json({ item: { ...item, guidance: requesterGuidance(item) }, ticketNo });
}

// "Submit to SAA" (spec section 4 step 2, second half) — fulfilling a
// ticket the admin filed against this office (status='awaiting_submission').
export async function fulfillRequested(req, res) {
  const { fileId } = req.body || {};
  if (!fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Attach the requested document before submitting." });
  if (!(await getFile(fileId))) return res.status(400).json({ error: "VALIDATION_ERROR", message: "That upload could not be found." });

  const ok = await repo.fulfillRequestedTicketForUser(req.params.id, req.portalUser.id, fileId);
  if (!ok) {
    return res.status(409).json({ error: "NOT_AWAITING_SUBMISSION", message: "This ticket isn't waiting on a submission from your office." });
  }
  const item = await repo.getTicketForUser(req.params.id, req.portalUser.id);
  res.json({ item: { ...item, guidance: requesterGuidance(item) } });
}

// Revision loop (spec step 6) — identical mechanics to the Student/Alumni
// Portal's resubmit: same ticket id, new file, back into the Queuing tab.
export async function resubmit(req, res) {
  const { fileId } = req.body || {};
  if (!fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Attach your corrected file before resubmitting." });
  if (!(await getFile(fileId))) return res.status(400).json({ error: "VALIDATION_ERROR", message: "That upload could not be found." });

  await repo.expireOverdueRevisions();
  const replaced = await repo.replaceTicketFileForUser(req.params.id, req.portalUser.id, fileId);
  if (!replaced) {
    return res.status(409).json({ error: "REVISION_WINDOW_CLOSED", message: "This ticket isn't awaiting revision, or its window has closed." });
  }
  await repo.resubmitTicketForUser(req.params.id, req.portalUser.id);
  const item = await repo.getTicketForUser(req.params.id, req.portalUser.id);
  res.json({ item: { ...item, guidance: requesterGuidance(item) } });
}

export async function downloadable(req, res) {
  const ticket = await repo.getTicketForUser(req.params.id, req.portalUser.id);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  res.json({
    submitted: ticket.file || null,
    signed: ticket.signedFile || null,
    signedReleased: Boolean(ticket.confirmed_at && ticket.signed_file_id),
  });
}

// ── E-signature inbox — requests ROUTED TO this office (steps 9-17) ─────
export async function listRoutes(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  res.json({ items: await repo.listRoutesForOffice(office.id) });
}

async function ownRouteOr404(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return null;
  const route = await repo.getRoute(req.params.routeId);
  // "Restrict Unauthorized Offices" (step 16) — this office only ever sees
  // or acts on a route addressed specifically to it.
  if (!route || route.office_id !== office.id) {
    res.status(404).json({ error: "NOT_FOUND", message: "No e-signature request found for your office with that id." });
    return null;
  }
  return route;
}

export async function latestFileForRoute(req, res) {
  const route = await ownRouteOr404(req, res);
  if (!route) return;
  const file = await repo.getLatestSignableFile(route.ticket_id);
  res.json({ file });
}

export async function signatureLayersForRoute(req, res) {
  const route = await ownRouteOr404(req, res);
  if (!route) return;
  const ticket = await repo.getTicket(route.ticket_id);
  const layers = await repo.listSignatureLayers(route.ticket_id);
  res.json({ original: ticket?.file || null, layers });
}

// The office adds its own signature — same underlying action as the
// admin's "sign on behalf of", called directly by the office this time.
export async function signRoute(req, res) {
  const route = await ownRouteOr404(req, res);
  if (!route) return;
  const { fileId } = req.body || {};
  if (!fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "fileId is required." });

  const ticket = await repo.getTicket(route.ticket_id);
  if (ticket?.confirmed_at) return res.status(ALREADY_RELEASED.status).json(ALREADY_RELEASED.body);
  if (route.confirmed_at) {
    return res.status(409).json({ error: "ROUTE_ALREADY_CONFIRMED", message: "Your office's signature is already confirmed." });
  }
  const sourceFile = await repo.getLatestSignableFile(route.ticket_id);
  const problem = await checkSignable({ sourceFile, signedFileId: fileId });
  if (problem) return res.status(problem.status).json(problem.body);
  const { layer, error } = await normalizeLayer(req.body.layer);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });

  await repo.signRoute(req.params.routeId, fileId, layer);
  res.json({ message: "Signature added." });
}

// Confirming is what makes it final — flips the admin's Document Queue
// view from "Pending" to "Done" for this office, same as if the admin had
// confirmed it on the office's behalf.
export async function confirmRoute(req, res) {
  const route = await ownRouteOr404(req, res);
  if (!route) return;
  if (!route.signed_file_id) {
    return res.status(409).json({ error: "NOT_SIGNED", message: "Add your office's signature before confirming." });
  }
  await repo.confirmRoute(req.params.routeId);
  res.json({ message: "Confirmed." });
}
