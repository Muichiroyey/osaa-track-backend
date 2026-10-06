import * as repo from "../repositories/endorsementRepo.js";
import { officeExists } from "../repositories/officeRepo.js";

export async function list(req, res) {
  res.json({ items: await repo.listEndorsements({ direction: req.query.direction }) });
}

export async function create(req, res) {
  const { direction, studentName, officeId, purpose } = req.body || {};
  if (!["inbound", "outbound"].includes(direction)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "direction must be inbound or outbound." });
  }
  if (direction === "outbound" && (!studentName || !studentName.trim())) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Student name is required for outbound endorsements." });
  }
  if (!purpose || !purpose.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Purpose / notes are required." });
  }
  if (!officeId || !(await officeExists(officeId))) {
    return res.status(403).json({ error: "UNAUTHORIZED_OFFICE", message: "That office is not in the authorized network." });
  }
  const id = await repo.createEndorsement(req.body);
  res.status(201).json({ id });
}

export async function addFile(req, res) {
  const { fileId } = req.body || {};
  if (!fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "fileId is required." });
  const id = await repo.addEndorsementFile(req.params.id, fileId);
  res.status(201).json({ id });
}

export async function updateStatus(req, res) {
  const { status } = req.body || {};
  if (!["pending", "acknowledged", "resolved"].includes(status)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Invalid status." });
  }
  const ok = await repo.setEndorsementStatus(req.params.id, status);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Endorsement not found." });
  res.json({ message: "Status updated." });
}
