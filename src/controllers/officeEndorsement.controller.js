import crypto from "node:crypto";
import * as repo from "../repositories/endorsementRepo.js";
import { listOfficesWithAccounts } from "../repositories/officeRepo.js";
import { getOfficeByUserId, officeExists, getOffice } from "../repositories/officeRepo.js";
import { getFile } from "../repositories/uploadedFileRepo.js";
import { checkAttachableFiles } from "../services/fileOwnership.js";
import { notify } from "../repositories/notificationRepo.js";

async function requireOffice(req, res) {
  const office = await getOfficeByUserId(req.portalUser.id);
  if (!office) {
    res.status(403).json({ error: "NO_OFFICE_LINKED", message: "This account isn't linked to an authorized office." });
    return null;
  }
  return office;
}

// Every endorsement this office sent or received (spec section 5 step 6 —
// "tracking for submission timestamps, acknowledgment status, and
// resolution updates across the sending and receiving Offices").
export async function list(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  res.json({ items: await repo.listEndorsementsForOffice(office.id) });
}

export async function getOne(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const item = await repo.getEndorsement(req.params.id);
  if (!item || (item.office_id !== office.id && item.source_office_id !== office.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Endorsement not found." });
  }
  res.json({ item });
}

/**
 * Create + route (spec steps 1-6): full student identity, a target office
 * from the system directory, remarks, and a direct dispatch to that
 * office's own Dashboard/inbox — no admin step in between.
 */
export async function create(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const { studentName, studentId, program, purpose, background, justification, fileIds, replyToId } = req.body || {};
  let { targetOfficeId } = req.body || {};

  if (!studentName?.trim() || !studentId?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Student name and ID number are required." });
  }

  // Answering a "Search for Student": the referral goes straight back to the
  // office that asked, and that search is closed out as resolved.
  let search = null;
  if (replyToId) {
    search = await repo.getEndorsement(replyToId);
    if (!search || search.kind !== "search" || search.office_id !== office.id || !search.source_office_id) {
      return res.status(404).json({ error: "NOT_FOUND", message: "That student search isn't addressed to your office." });
    }
    targetOfficeId = search.source_office_id;
  }
  if (!targetOfficeId || !(await officeExists(targetOfficeId))) {
    return res.status(403).json({ error: "UNAUTHORIZED_OFFICE", message: "That office is not in the authorized network." });
  }
  if (Number(targetOfficeId) === office.id) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Select a different office to endorse this student to." });
  }

  const id = await repo.createEndorsement({
    direction: "outbound",
    studentName: studentName.trim(),
    studentId: studentId.trim(),
    program: (program || "").trim() || null,
    officeId: targetOfficeId,
    sourceOfficeId: office.id,
    purpose: (purpose || "").trim() || null,
    background: (background || "").trim() || null,
    justification: (justification || "").trim() || null,
    replyToId: search ? search.id : null,
  });
  if (search) await repo.setEndorsementStatus(search.id, "resolved");

  if (Array.isArray(fileIds)) {
    for (const fileId of fileIds) {
      if (await getFile(fileId)) await repo.addEndorsementFile(id, fileId);
    }
  }

  const targetOffice = await getOffice(targetOfficeId);
  if (targetOffice?.user_id) {
    await notify({
      userId: targetOffice.user_id,
      type: "endorsement_received",
      title: "Student endorsement received",
      body: `${office.name} endorsed ${studentName.trim()} to your office${purpose ? ` — ${purpose.trim()}` : ""}.`,
      linkType: "student-endorsement",
      linkId: id,
    });
  }

  const item = await repo.getEndorsement(id);
  res.status(201).json({ item });
}

/**
 * "Search for Student": this office describes the kind of student it needs
 * (source office + notes + optional attachment). The receiving office answers
 * with a referral. Sent to "all" it goes to every office that has a portal
 * login, as one independent request per office (so each can acknowledge or
 * answer on its own) that share a batch key.
 */
export async function createSearch(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const { targetOfficeId, notes, fileIds } = req.body || {};
  if (!notes?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Describe the kind of student you are looking for." });
  }

  let targets;
  if (targetOfficeId === "all") {
    targets = (await listOfficesWithAccounts()).filter((o) => o.id !== office.id);
    if (targets.length === 0) return res.status(400).json({ error: "VALIDATION_ERROR", message: "There are no other offices to send this to." });
  } else {
    if (!targetOfficeId || !(await officeExists(targetOfficeId))) {
      return res.status(403).json({ error: "UNAUTHORIZED_OFFICE", message: "That office is not in the authorized network." });
    }
    if (Number(targetOfficeId) === office.id) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Select a different office." });
    }
    targets = [await getOffice(targetOfficeId)];
  }
  const ids = Array.isArray(fileIds) ? fileIds : [];
  if (ids.length > 0) {
    const problem = await checkAttachableFiles(ids, req.portalUser.id);
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
  }

  const batchKey = targets.length > 1 || targetOfficeId === "all" ? crypto.randomBytes(12).toString("hex") : null;
  let firstId = null;
  for (const target of targets) {
    const id = await repo.createEndorsement({
      direction: "outbound",
      officeId: target.id,
      sourceOfficeId: office.id,
      purpose: "Search for student",
      background: notes.trim(),
      kind: "search",
      batchKey,
    });
    firstId = firstId ?? id;
    for (const fileId of ids) await repo.addEndorsementFile(id, fileId);
    if (target.user_id) {
      await notify({
        userId: target.user_id,
        type: "endorsement_received",
        title: "Student search request",
        body: `${office.name} is looking for a student: ${notes.trim().slice(0, 120)}`,
        linkType: "student-endorsement",
        linkId: id,
      });
    }
  }
  res.status(201).json({ count: targets.length, item: await repo.getEndorsement(firstId) });
}

// Acknowledge / resolve — only the RECIPIENT office may move the status
// (spec section 5 step 6, "acknowledgment status, and resolution updates").
export async function updateStatus(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const { status } = req.body || {};
  if (!["pending", "acknowledged", "resolved"].includes(status)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid status." });
  }
  const ok = await repo.setEndorsementStatusForOffice(req.params.id, office.id, status);
  if (!ok) {
    return res.status(404).json({ error: "NOT_FOUND", message: "You can only update endorsements addressed to your office." });
  }
  res.json({ message: "Status updated." });
}
