import { pool } from "../config/db.js";
import { expireOverdueRevisions } from "../repositories/documentQueueRepo.js";

export async function getSummary(req, res) {
  await expireOverdueRevisions();

  const [[docQueue]] = await pool.query(
    `SELECT
       SUM(status = 'pending') AS pendingSaa,
       SUM(status IN ('approved_for_signing', 'approved_for_esigning')) AS approved,
       SUM(status = 'revision_requested') AS revisionRequested
     FROM document_queue_tickets`
  );

  const [[scholarships]] = await pool.query(
    `SELECT COUNT(*) AS active FROM scholarships WHERE status = 'active'`
  );
  const [[applications]] = await pool.query(
    `SELECT COUNT(*) AS newApplications FROM scholarship_applicants WHERE status = 'pending'`
  );

  const [[announcements]] = await pool.query(
    `SELECT
       SUM(status = 'draft') AS drafts,
       SUM(status = 'published') AS published,
       SUM(status = 'published' AND priority = 'urgent') AS urgent
     FROM announcements`
  );

  const [[achievements]] = await pool.query(
    `SELECT
       SUM(status = 'pending') AS pendingValidation,
       SUM(status = 'approved' AND DATE(decided_at) = CURDATE()) AS approvedToday
     FROM achievements`
  );

  const [[users]] = await pool.query(
    `SELECT COUNT(*) AS totalUsers, SUM(status = 'pending') AS pendingApproval FROM users`
  );

  const num = (v) => Number(v || 0);

  const activity = [];
  if (num(docQueue.pendingSaa) > 0) {
    activity.push({
      id: "docq-pending",
      tone: "warning",
      message: `${num(docQueue.pendingSaa)} pending document${num(docQueue.pendingSaa) === 1 ? "" : "s"} in the document queue awaiting review.`,
    });
  }
  if (num(applications.newApplications) > 0) {
    activity.push({
      id: "scholar-new",
      tone: "success",
      message: `${num(applications.newApplications)} new scholarship application${num(applications.newApplications) === 1 ? "" : "s"} received across active postings.`,
    });
  }
  if (num(docQueue.revisionRequested) > 0) {
    activity.push({
      id: "docq-revision",
      tone: "warning",
      message: `${num(docQueue.revisionRequested)} document${num(docQueue.revisionRequested) === 1 ? "" : "s"} returned for revision — 7-day compliance window in effect.`,
    });
  }
  if (num(achievements.pendingValidation) > 0) {
    activity.push({
      id: "achieve-pending",
      tone: "warning",
      message: `${num(achievements.pendingValidation)} achievement submission${num(achievements.pendingValidation) === 1 ? "" : "s"} awaiting validation.`,
    });
  }

  res.json({
    documentSignatureRelay: { pendingSaa: num(docQueue.pendingSaa), approved: num(docQueue.approved) },
    scholarships: { active: num(scholarships.active), newApplications: num(applications.newApplications) },
    announcements: { drafts: num(announcements.drafts), published: num(announcements.published), urgent: num(announcements.urgent) },
    achievements: { pendingValidation: num(achievements.pendingValidation), approvedToday: num(achievements.approvedToday) },
    userManagement: { totalUsers: num(users.totalUsers), pendingApproval: num(users.pendingApproval) },
    badges: {
      announcements: num(announcements.urgent),
      documentQueue: num(docQueue.pendingSaa),
      achievementManagement: num(achievements.pendingValidation),
    },
    activity,
  });
}
