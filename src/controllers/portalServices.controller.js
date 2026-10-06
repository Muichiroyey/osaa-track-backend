import * as scholarshipRepo from "../repositories/scholarshipRepo.js";
import * as achievementRepo from "../repositories/achievementRepo.js";
import * as alumniRepo from "../repositories/alumniRepo.js";
import { getFile } from "../repositories/uploadedFileRepo.js";
import { phToday } from "../config/timezone.js";
import { checkAttachableFiles } from "../services/fileOwnership.js";

// ── Scholarships (students) ─────────────────────────────────────────────

export async function listScholarships(req, res) {
  const [items, counts] = await Promise.all([
    scholarshipRepo.listOpenScholarshipsForUser(req.portalUser.id),
    scholarshipRepo.getApplicationCountsForUser(req.portalUser.id),
  ]);
  res.json({ items, counts });
}

export async function listMyApplications(req, res) {
  const [items, counts] = await Promise.all([
    scholarshipRepo.listApplicationsForUser(req.portalUser.id),
    scholarshipRepo.getApplicationCountsForUser(req.portalUser.id),
  ]);
  res.json({ items, counts });
}

/**
 * Apply to a scholarship. The requirement checklist the admin defined on
 * the posting is enforced here, not just displayed: every requirement must
 * have a file attached to it before the application is accepted, because
 * the admin's evaluation screen is built around inspecting exactly those
 * files before deciding.
 */
export async function apply(req, res) {
  const scholarship = await scholarshipRepo.getOpenScholarship(req.params.id);
  if (!scholarship) {
    return res.status(404).json({ error: "NOT_FOUND", message: "This scholarship is no longer open for applications." });
  }
  // The deadline is a calendar date; "passed" means before today in the Philippines (YYYY-MM-DD strings compare correctly as text).
  if (scholarship.deadline && String(scholarship.deadline).slice(0, 10) < phToday()) {
    return res.status(409).json({ error: "DEADLINE_PASSED", message: "The deadline for this scholarship has passed." });
  }
  if (await scholarshipRepo.hasUserApplied(req.portalUser.id, scholarship.id)) {
    return res.status(409).json({ error: "ALREADY_APPLIED", message: "You've already applied to this scholarship." });
  }

  const studentId = (req.body?.studentId || req.portalUser.code || "").trim();
  const program = (req.body?.program || req.portalUser.department || "").trim();
  const files = Array.isArray(req.body?.files) ? req.body.files : [];

  const requirements = scholarship.requirements || [];
  const missing = requirements.filter(
    (requirement) => !files.some((f) => f.label === requirement && f.fileId)
  );
  if (missing.length > 0) {
    return res.status(400).json({
      error: "MISSING_REQUIREMENTS",
      message: `Upload a file for each requirement. Still missing: ${missing.join(", ")}.`,
    });
  }

  // Confirm every referenced upload actually exists before creating the
  // applicant row, so a half-attached application never reaches the admin.
  for (const f of files) {
    if (!(await getFile(f.fileId))) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "One of your uploads could not be found. Please attach it again." });
    }
  }

  const applicantId = await scholarshipRepo.createApplicantForUser({
    scholarshipId: scholarship.id,
    userId: req.portalUser.id,
    studentName: req.portalUser.name,
    studentId,
    program,
  });

  for (const f of files) {
    await scholarshipRepo.addApplicantFile(applicantId, f.fileId, f.label || null);
  }
  // Anything else the applicant attached (e.g. the printed, filled-out and
  // scanned application form) — only files this student uploaded themselves.
  const extraIds = Array.isArray(req.body?.extraFileIds) ? req.body.extraFileIds : [];
  if (extraIds.length > 0) {
    const problem = await checkAttachableFiles(extraIds, req.portalUser.id);
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
    for (const fileId of extraIds) await scholarshipRepo.addApplicantFile(applicantId, fileId, "Additional attachment");
  }

  res.status(201).json({ id: applicantId, message: "Application submitted." });
}

// ── My Achievements (students) ──────────────────────────────────────────

export async function listAchievements(req, res) {
  const [items, counts] = await Promise.all([
    achievementRepo.listAchievementsForUser(req.portalUser.id),
    achievementRepo.getAchievementCountsForUser(req.portalUser.id),
  ]);
  res.json({ items, counts, colleges: achievementRepo.COLLEGE_PROGRAMS });
}

export async function getAchievement(req, res) {
  const item = await achievementRepo.getAchievementForUser(req.params.id, req.portalUser.id);
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Achievement not found." });
  res.json({ item });
}

/**
 * Submit an achievement for validation. It lands in the admin's
 * Achievement Management grid under the student's program as 'pending',
 * exactly like an entry the admin typed in.
 *
 * The student's form collects their name in parts plus a program, so the
 * college is derived from the program here rather than asked for twice —
 * the admin's own create endpoint rejects a college/program pair that
 * doesn't match, and deriving it means the two panels can never disagree.
 */
export async function createAchievement(req, res) {
  const { lastName, firstName, middleInitial, program, yearLevel, title, description, dateAchieved, studentNumber, college: collegeEntered } = req.body || {};

  if (!lastName?.trim() || !firstName?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "First name and last name are required." });
  }
  if (!studentNumber?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Enter your student number." });
  }
  if (!program) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Select your program." });
  }
  if (!title?.trim()) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Enter the achievement category or title." });
  }

  const college = achievementRepo.collegeForProgram(program);
  if (!college) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "That program isn't on the list of recognized programs." });
  }

  const fileIds = Array.isArray(req.body?.fileIds) ? req.body.fileIds : [];
  if (fileIds.length === 0) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Attach a scan or photo of your certificate — the SAA validates the evidence before approving.",
    });
  }
  for (const fileId of fileIds) {
    if (!(await getFile(fileId))) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "One of your uploads could not be found. Please attach it again." });
    }
  }

  const middle = middleInitial?.trim() ? ` ${middleInitial.trim().replace(/\.$/, "")}.` : "";
  const studentName = `${firstName.trim()}${middle} ${lastName.trim()}`.replace(/\s+/g, " ");

  const id = await achievementRepo.createAchievementForUser({
    userId: req.portalUser.id,
    studentName,
    college,
    program,
    yearLevel: yearLevel || null,
    studentNumber: studentNumber.trim(),
    // What the student typed in the College box. The admin's program grid still
    // groups by the derived `college` above, so the two can never disagree there.
    collegeEntered: (collegeEntered || "").trim() || college,
    title: title.trim(),
    description: description?.trim() || null,
    dateAchieved: dateAchieved || null,
  });

  for (const fileId of fileIds) {
    await achievementRepo.addAchievementFile(id, fileId, "Proof of achievement");
  }

  const item = await achievementRepo.getAchievementForUser(id, req.portalUser.id);
  res.status(201).json({ item });
}

// ── Alumni tracer profile (alumni) ──────────────────────────────────────

const EMPLOYMENT_STATUSES = [
  "Employed",
  "Self-employed",
  "Unemployed",
  "Further studies",
  "Not looking for work",
];

export async function getMyProfile(req, res) {
  let profile = await alumniRepo.getProfileByUserId(req.portalUser.id);

  // First visit: adopt the row the admin may already have entered for this
  // graduate instead of creating a second one in the directory.
  if (!profile) {
    const claimedId = await alumniRepo.claimProfileForUser(req.portalUser.id, req.portalUser.name);
    if (claimedId) profile = await alumniRepo.getProfileByUserId(req.portalUser.id);
  }

  res.json({
    profile,
    employmentStatuses: EMPLOYMENT_STATUSES,
    account: {
      name: req.portalUser.name,
      email: req.portalUser.email,
      code: req.portalUser.code,
      department: req.portalUser.department,
    },
  });
}

export async function updateMyProfile(req, res) {
  const { program, batchYear, employmentStatus, employer, jobDescription } = req.body || {};

  if (employmentStatus && !EMPLOYMENT_STATUSES.includes(employmentStatus)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Select a valid employment status." });
  }
  const year = batchYear ? Number(batchYear) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1950 || year > new Date().getFullYear() + 1)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Enter a valid graduation year." });
  }

  // The name on the tracer record follows the account name the admin
  // issued — it isn't a free-text field here, so the directory can't drift
  // away from User Management.
  await alumniRepo.upsertProfileForUser(req.portalUser.id, {
    name: req.portalUser.name,
    program: program || null,
    batchYear: year,
    employmentStatus: employmentStatus || null,
    employer: employer || null,
    jobDescription: jobDescription || null,
  });

  res.json({ profile: await alumniRepo.getProfileByUserId(req.portalUser.id) });
}
