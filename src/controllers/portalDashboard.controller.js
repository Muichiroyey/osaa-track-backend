import * as queueRepo from "../repositories/documentQueueRepo.js";
import * as announcementRepo from "../repositories/announcementRepo.js";
import * as scholarshipRepo from "../repositories/scholarshipRepo.js";
import * as achievementRepo from "../repositories/achievementRepo.js";
import * as jobRepo from "../repositories/jobPostingRepo.js";
import * as alumniRepo from "../repositories/alumniRepo.js";
import * as chatRepo from "../repositories/chatRepo.js";
import { pool } from "../config/db.js";
import { computeUnread, countSince, markModuleSeen } from "../services/unreadBadges.js";

/**
 * The dashboard card counts and activity feed, built per signed-in user.
 * Both types share the shape the Admin Panel's own dashboard uses (a
 * summary object plus an `activity` array) so the portal's Home page can
 * reuse the same StatCard pattern — but every number here is scoped to the
 * one account asking, never a system-wide total.
 */
export async function getSummary(req, res) {
  const user = req.portalUser;
  const audienceKey = user.type === "student" ? "students" : "alumni";

  // Same opportunistic sweep the admin's list does, so a requester sees
  // their lapsed revision window as "Expired" without waiting for an admin
  // to open the queue first.
  await queueRepo.expireOverdueRevisions();

  const [documents, announcements] = await Promise.all([
    queueRepo.getTicketCountsForUser(user.id),
    announcementRepo.getAudienceHighlights(audienceKey),
  ]);

  const summary = { documents, announcements };
  const activity = [];

  if (documents.needsRevision > 0) {
    activity.push({
      id: "doc-revision",
      tone: "warning",
      message: `${documents.needsRevision} document${documents.needsRevision === 1 ? "" : "s"} returned for revision — re-upload before the compliance window closes.`,
      to: "/document-queue",
    });
  }
  if (documents.pending > 0) {
    activity.push({
      id: "doc-pending",
      tone: "info",
      message: `${documents.pending} document${documents.pending === 1 ? " is" : "s are"} waiting for SAA review.`,
      to: "/document-queue",
    });
  }
  if (documents.approved > 0) {
    activity.push({
      id: "doc-approved",
      tone: "success",
      message: `${documents.approved} document request${documents.approved === 1 ? " has" : "s have"} been approved — open the ticket for the next step.`,
      to: "/document-queue",
    });
  }
  if (documents.expired > 0) {
    activity.push({
      id: "doc-expired",
      tone: "danger",
      message: `${documents.expired} ticket${documents.expired === 1 ? "" : "s"} expired without a revision and must be submitted again.`,
      to: "/document-queue",
    });
  }
  if (announcements.urgent > 0) {
    activity.push({
      id: "urgent-announcements",
      tone: "danger",
      message: `${announcements.urgent} urgent announcement${announcements.urgent === 1 ? "" : "s"} addressed to you.`,
      to: "/announcements",
    });
  }

  if (user.type === "student") {
    const [applications, achievements, openScholarships] = await Promise.all([
      scholarshipRepo.getApplicationCountsForUser(user.id),
      achievementRepo.getAchievementCountsForUser(user.id),
      pool.query("SELECT COUNT(*) AS active FROM scholarships WHERE status = 'active'"),
    ]);
    summary.scholarships = { active: Number(openScholarships[0][0].active || 0), ...applications };
    summary.achievements = achievements;

    if (applications.accepted > 0) {
      activity.push({
        id: "scholarship-accepted",
        tone: "success",
        message: `${applications.accepted} scholarship application${applications.accepted === 1 ? " was" : "s were"} accepted.`,
        to: "/scholarships",
      });
    }
    if (achievements.pending > 0) {
      activity.push({
        id: "achievement-pending",
        tone: "warning",
        message: `${achievements.pending} achievement submission${achievements.pending === 1 ? " is" : "s are"} awaiting validation.`,
        to: "/achievements",
      });
    }
    if (achievements.rejected > 0) {
      activity.push({
        id: "achievement-rejected",
        tone: "danger",
        message: `${achievements.rejected} achievement submission${achievements.rejected === 1 ? " was" : "s were"} returned — open it to read the reason.`,
        to: "/achievements",
      });
    }
  } else {
    const [jobs, profile] = await Promise.all([
      jobRepo.countActiveJobPostings(),
      alumniRepo.getProfileByUserId(user.id),
    ]);
    summary.jobs = jobs;
    summary.profile = {
      exists: Boolean(profile),
      employmentStatus: profile?.employment_status || null,
      // A tracer record with no employment information on it is the one
      // thing the alumni module actually needs from the graduate, so the
      // dashboard says so rather than leaving the card blank.
      incomplete: !profile || !profile.employment_status || !profile.batch_year,
    };
    if (summary.profile.incomplete) {
      activity.push({
        id: "profile-incomplete",
        tone: "warning",
        message: "Your graduate tracer profile is missing employment information — update it so SAA records stay current.",
        to: "/profile",
      });
    }
    if (jobs.closingSoon > 0) {
      activity.push({
        id: "jobs-closing",
        tone: "info",
        message: `${jobs.closingSoon} job posting${jobs.closingSoon === 1 ? "" : "s"} close within two weeks.`,
        to: "/jobs",
      });
    }
  }

  // Unread-style nudge for SAA Chat: anything the office sent after the
  // last message this user sent themselves.
  const conversation = await chatRepo.getConversationForUser(user.id);
  let unreadFromSaa = 0;
  if (conversation) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM chat_messages
       WHERE conversation_id = ? AND sender_type = 'admin' AND unsent_at IS NULL
         AND id > COALESCE((SELECT MAX(id) FROM chat_messages WHERE conversation_id = ? AND sender_type = 'user'), 0)`,
      [conversation.id, conversation.id]
    );
    unreadFromSaa = Number(rows[0].c || 0);
  }
  summary.chat = { unreadFromSaa };
  if (unreadFromSaa > 0) {
    activity.push({
      id: "chat-reply",
      tone: "info",
      message: `${unreadFromSaa} new message${unreadFromSaa === 1 ? "" : "s"} from the SAA office.`,
      to: "/saa-chat",
    });
  }

  // Red counts for everything that "arrives" in a module. These are real
  // unread numbers: they count what is new since the person last opened the
  // module (see services/unreadBadges.js). Document Queue and SAA Chat keep
  // their own always-current counts below.
  const specs = {
    announcements: (seen) =>
      countSince(
        `SELECT COUNT(*) AS c FROM announcements
         WHERE status = 'published' AND JSON_CONTAINS(audience, JSON_QUOTE(?))
           AND COALESCE(published_at, created_at) > ?`,
        [audienceKey, seen]
      ),
  };
  if (user.type === "student") {
    specs.campusFeed = (seen) =>
      countSince("SELECT COUNT(*) AS c FROM campus_feed_posts WHERE hidden = 0 AND created_at > ?", [seen]);
    specs.scholarships = async (seen) =>
      (await countSince("SELECT COUNT(*) AS c FROM scholarships WHERE status = 'active' AND created_at > ?", [seen])) +
      (await countSince(
        "SELECT COUNT(*) AS c FROM scholarship_applicants WHERE user_id = ? AND decided_at IS NOT NULL AND decided_at > ?",
        [user.id, seen]
      ));
    specs.achievements = (seen) =>
      countSince("SELECT COUNT(*) AS c FROM achievements WHERE user_id = ? AND decided_at IS NOT NULL AND decided_at > ?", [user.id, seen]);
    specs.studentLeaders = (seen) =>
      countSince("SELECT COUNT(*) AS c FROM organization_documents WHERE hidden = 0 AND created_at > ?", [seen]);
  } else {
    specs.jobs = (seen) =>
      countSince("SELECT COUNT(*) AS c FROM job_postings WHERE status = 'active' AND created_at > ?", [seen]);
  }
  const unread = await computeUnread(user.id, specs);

  summary.badges = {
    documentQueue: documents.needsRevision + documents.pending,
    saaChat: unreadFromSaa,
    ...unread.counts,
  };
  // Which of the badges above are server-tracked unread counts (the sidebar
  // acknowledges those by telling the server, not by remembering a number).
  summary.trackedBadges = unread.tracked;
  summary.activity = activity;

  res.json(summary);
}

// The sidebar tells us a module was opened, so its red count can reset.
const SEEN_MODULES = {
  student: ["announcements", "campusFeed", "scholarships", "achievements", "studentLeaders"],
  alumni: ["announcements", "jobs"],
};

export async function markSeen(req, res) {
  const key = String(req.body?.module || "");
  if (!(SEEN_MODULES[req.portalUser.type] || []).includes(key)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Unknown module." });
  }
  await markModuleSeen(req.portalUser.id, key);
  res.json({ ok: true });
}
