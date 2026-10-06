import * as repo from "../repositories/achievementRepo.js";

export async function list(req, res) {
  const items = await repo.listAchievements({
    college: req.query.college,
    program: req.query.program,
    status: req.query.status,
  });
  res.json({ items });
}

export async function programs(req, res) {
  const counts = await repo.programCounts();
  res.json({ colleges: repo.COLLEGE_PROGRAMS, colors: repo.PROGRAM_COLORS, counts });
}

export async function create(req, res) {
  const { studentName, college, program, title } = req.body || {};
  if (!studentName || !college || !program || !title) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "studentName, college, program, and title are required." });
  }
  if (!repo.COLLEGE_PROGRAMS[college] || !repo.COLLEGE_PROGRAMS[college].includes(program)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Program does not belong to the selected college." });
  }
  const id = await repo.createAchievement(req.body);
  res.status(201).json({ id });
}

export async function addFile(req, res) {
  const { fileId, label } = req.body || {};
  if (!fileId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "fileId is required." });
  const id = await repo.addAchievementFile(req.params.id, fileId, label);
  res.status(201).json({ id });
}

export async function decide(req, res) {
  const { status, rejectionReason } = req.body || {};
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "status must be approved or rejected." });
  }
  if (status === "rejected" && (!rejectionReason || !rejectionReason.trim())) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Rejection requires a written justification." });
  }
  const ok = await repo.decideAchievement(req.params.id, status, rejectionReason);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Achievement not found." });
  res.json({ message: `Achievement ${status}.` });
}
