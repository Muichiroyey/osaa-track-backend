import * as dq from "../repositories/documentQueueRepo.js";
import * as achievements from "../repositories/achievementRepo.js";

/**
 * SAA STAFF — what staff may and may not do (the permission boundaries)
 * ───────────────────────────────────────────────────────────────────────
 * Staff run the same Document Queue and Achievement Management as the
 * admin, with these differences — enforced HERE on the server, not just by
 * hiding buttons:
 *
 *  Document Queue
 *    ✓ monitor everything, pre-screen with the document viewer
 *    ✓ Approve for PHYSICAL signing (standard / simple documents)
 *    ✓ Reject / Request revision (a pre-screening outcome)
 *    ✓ Forward complex documents to the SAA Dean's evaluation tab
 *    ✗ Approve for e-signing, add an e-signature, route a document to an
 *      office for signature, confirm/release a signature — final e-signatures
 *      belong to the SAA Dean (admin) alone
 *    ✗ once forwarded, a ticket is the Dean's: staff can no longer decide it
 *
 *  Achievement Management
 *    ✓ initial screening: Verify & route to the Dean, or flag/reject a
 *      submission that fails screening (with a written reason)
 *    ✗ final approval — only the Dean approves
 */

// ── Document Queue ───────────────────────────────────────────────────────

// Blocks every e-signature endpoint for staff. Mounted in front of the shared
// document-queue router, so the admin's own routes are untouched.
const ESIGN_PATHS = [
  /^\/[^/]+\/sign$/,
  /^\/[^/]+\/confirm-signature$/,
  /^\/[^/]+\/routes$/,
  /^\/routes\/[^/]+(\/sign|\/confirm)?$/,
];

export function guardDocumentQueue(req, res, next) {
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  if (isWrite && ESIGN_PATHS.some((re) => re.test(req.path))) {
    return res.status(403).json({
      error: "DEAN_ONLY",
      message: "Final e-signatures are issued by the SAA Dean. Forward the document to the Dean's evaluation tab instead.",
    });
  }
  // The Queuing Archive's bulk delete is a Dean/admin clean-up action.
  if (req.method === "DELETE" && req.path === "/archive") {
    return res.status(403).json({ error: "DEAN_ONLY", message: "Clearing the Queuing Archive is reserved for the SAA Dean." });
  }
  next();
}

// POST /document-queue/:id/decide — same handler as the admin's, but staff
// may not choose e-signing and may not touch a ticket that is already with
// the Dean. (Runs before the shared router; falls through with next().)
export async function guardDecide(req, res, next) {
  const action = req.body?.action;
  if (action === "approve_esign") {
    return res.status(403).json({
      error: "DEAN_ONLY",
      message: "Approving for e-signing is reserved for the SAA Dean. Use \u201cForward to Dean\u201d for documents that need an e-signature.",
    });
  }
  const ticket = await dq.getTicket(req.params.id);
  if (ticket?.forwarded_to_dean_at && ticket.status === "pending") {
    return res.status(409).json({
      error: "ALREADY_FORWARDED",
      message: "This document has been forwarded to the SAA Dean and is awaiting the Dean's evaluation.",
    });
  }
  next();
}

export async function forwardToDean(req, res) {
  const ticket = await dq.getTicket(req.params.id);
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND", message: "Ticket not found." });
  if (ticket.forwarded_to_dean_at && ticket.status === "pending") {
    return res.status(409).json({ error: "ALREADY_FORWARDED", message: "This document was already forwarded to the SAA Dean." });
  }
  if (ticket.status !== "pending") {
    return res.status(409).json({ error: "NOT_PENDING", message: "Only a pending document can be forwarded to the Dean." });
  }
  if (!ticket.file_id) {
    return res.status(409).json({ error: "NO_DOCUMENT", message: "There is no document attached to this ticket yet." });
  }
  const ok = await dq.forwardTicketToDean(req.params.id, req.staffUser.id, req.body?.note);
  if (!ok) return res.status(409).json({ error: "NOT_PENDING", message: "This document can't be forwarded right now." });
  res.json({ item: await dq.getTicket(req.params.id) });
}

// ── Achievement Management ───────────────────────────────────────────────

// POST /achievements/:id/verify — "flag and route verified records to the SAA
// Dean's Screen".
export async function verifyAchievement(req, res) {
  const item = await achievements.getAchievementById(req.params.id);
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Achievement not found." });
  if (item.status !== "pending") {
    return res.status(409).json({ error: "ALREADY_DECIDED", message: "This submission has already been decided by the SAA Dean." });
  }
  if (item.staff_verified_at) {
    return res.status(409).json({ error: "ALREADY_VERIFIED", message: "This record was already verified and routed to the SAA Dean." });
  }
  const ok = await achievements.staffVerifyAchievement(req.params.id, req.staffUser.id, req.body?.note);
  if (!ok) return res.status(409).json({ error: "ALREADY_VERIFIED", message: "This record can't be verified right now." });
  res.json({ item: await achievements.getAchievementById(req.params.id) });
}

// PATCH /achievements/:id/decide — staff may only flag/reject at screening.
export async function guardAchievementDecide(req, res, next) {
  if (req.body?.status === "approved") {
    return res.status(403).json({
      error: "DEAN_ONLY",
      message: "Final approval of an achievement is made by the SAA Dean. Use \u201cVerify & Route to Dean\u201d once you've screened it.",
    });
  }
  const item = await achievements.getAchievementById(req.params.id);
  if (item?.staff_verified_at && item.status === "pending") {
    return res.status(409).json({
      error: "ALREADY_VERIFIED",
      message: "This record was verified and routed to the SAA Dean, who makes the final decision.",
    });
  }
  next();
}
