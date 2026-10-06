import { pool } from "../config/db.js";
import { expireOverdueRevisions } from "../repositories/documentQueueRepo.js";

/**
 * SAA STAFF — HOME (spec section 1)
 * High-level activity summaries, incoming queue alerts, pending endorsement
 * counters and recent system activity. Same live aggregate style as the admin
 * Home, minus User Management / Document Repository (staff don't have those),
 * plus what is specific to a staff member's day: what still needs screening
 * and what has already been passed up to the Dean.
 */
const num = (v) => Number(v || 0);

export async function getSummary(req, res) {
  await expireOverdueRevisions();

  const [[doc]] = await pool.query(
    `SELECT
       SUM(status = 'pending' AND forwarded_to_dean_at IS NULL) AS toScreen,
       SUM(status = 'pending' AND forwarded_to_dean_at IS NOT NULL) AS withDean,
       SUM(status = 'awaiting_submission') AS awaitingOffice,
       SUM(status IN ('approved_for_signing', 'approved_for_esigning')) AS approved,
       SUM(status = 'revision_requested') AS revisionRequested
     FROM document_queue_tickets`
  );
  const [[sch]] = await pool.query(`SELECT COUNT(*) AS active FROM scholarships WHERE status = 'active'`);
  const [[apps]] = await pool.query(`SELECT COUNT(*) AS n FROM scholarship_applicants WHERE status = 'pending'`);
  const [[ann]] = await pool.query(
    `SELECT SUM(status = 'draft') AS drafts, SUM(status = 'published') AS published,
            SUM(status = 'published' AND priority = 'urgent') AS urgent
     FROM announcements`
  );
  const [[ach]] = await pool.query(
    `SELECT
       SUM(status = 'pending' AND staff_verified_at IS NULL) AS toScreen,
       SUM(status = 'pending' AND staff_verified_at IS NOT NULL) AS withDean
     FROM achievements`
  );
  const [[end]] = await pool.query(
    `SELECT SUM(status = 'pending') AS pending, SUM(status = 'pending' AND direction = 'inbound') AS pendingInbound,
            SUM(status = 'pending' AND direction = 'outbound') AS pendingOutbound
     FROM endorsements`
  );
  const [[chat]] = await pool.query(
    `SELECT COUNT(*) AS n FROM chat_conversations c
     WHERE (SELECT m.sender_type FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) = 'user'
       AND (SELECT m.unsent_at FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) IS NULL`
  );

  const activity = [];
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (num(doc.toScreen) > 0) {
    activity.push({ id: "docq-screen", tone: "warning", message: `${plural(num(doc.toScreen), "document")} in the Document Queue waiting for your pre-screening.` });
  }
  if (num(doc.withDean) > 0) {
    activity.push({ id: "docq-dean", tone: "success", message: `${plural(num(doc.withDean), "document")} forwarded to the SAA Dean and awaiting evaluation.` });
  }
  if (num(apps.n) > 0) {
    activity.push({ id: "scholar-new", tone: "success", message: `${plural(num(apps.n), "scholarship application")} received across active postings.` });
  }
  if (num(ach.toScreen) > 0) {
    activity.push({ id: "achieve-screen", tone: "warning", message: `${plural(num(ach.toScreen), "achievement submission")} waiting for initial screening.` });
  }
  if (num(end.pending) > 0) {
    activity.push({ id: "endorse-pending", tone: "warning", message: `${plural(num(end.pending), "student endorsement")} pending.` });
  }
  if (num(chat.n) > 0) {
    activity.push({ id: "chat-waiting", tone: "warning", message: `${plural(num(chat.n), "SAA Chat conversation")} waiting for a reply.` });
  }
  if (num(doc.revisionRequested) > 0) {
    activity.push({ id: "docq-revision", tone: "warning", message: `${plural(num(doc.revisionRequested), "document")} returned for revision — 7-day compliance window in effect.` });
  }

  res.json({
    documentQueue: {
      toScreen: num(doc.toScreen),
      withDean: num(doc.withDean),
      awaitingOffice: num(doc.awaitingOffice),
      approved: num(doc.approved),
    },
    scholarships: { active: num(sch.active), newApplications: num(apps.n) },
    announcements: { drafts: num(ann.drafts), published: num(ann.published), urgent: num(ann.urgent) },
    achievements: { toScreen: num(ach.toScreen), withDean: num(ach.withDean) },
    endorsements: { pending: num(end.pending), inbound: num(end.pendingInbound), outbound: num(end.pendingOutbound) },
    chat: { waiting: num(chat.n) },
    badges: {
      announcements: num(ann.urgent),
      documentQueue: num(doc.toScreen),
      achievementManagement: num(ach.toScreen),
      studentEndorsement: num(end.pending),
      saaChat: num(chat.n),
    },
    activity,
  });
}
