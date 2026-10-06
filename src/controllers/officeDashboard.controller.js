import { pool } from "../config/db.js";
import { getOfficeByUserId } from "../repositories/officeRepo.js";
import * as docRepo from "../repositories/documentQueueRepo.js";
import * as endorsementRepo from "../repositories/endorsementRepo.js";
import * as announcementRepo from "../repositories/announcementRepo.js";
import { computeUnread, countSince, markModuleSeen } from "../services/unreadBadges.js";
import * as chatRepo from "../repositories/chatRepo.js";
import { parseDbDate } from "../config/timezone.js";

/**
 * DASHBOARD (spec section 1) — "provides each Office with a centralized
 * overview of its assigned activities, pending requests, updates, and
 * available system features," scoped only to this office's own data.
 * Same badges+activity contract as the Student/Alumni Portal's
 * /api/portal/summary, so Home.jsx and the sidebar badges work the same way.
 */
export async function summary(req, res) {
  const office = await getOfficeByUserId(req.portalUser.id);
  if (!office) {
    return res.status(403).json({ error: "NO_OFFICE_LINKED", message: "This account isn't linked to an authorized office." });
  }

  const [tickets, routes, endorsements, announcements] = await Promise.all([
    docRepo.listTicketsForUser(req.portalUser.id, {}),
    docRepo.listRoutesForOffice(office.id),
    endorsementRepo.listEndorsementsForOffice(office.id),
    announcementRepo.listPublishedForAudience("offices"),
  ]);

  const actionNeeded = tickets.filter((t) => ["awaiting_submission", "revision_requested"].includes(t.status)).length;
  const pendingReview = tickets.filter((t) => t.status === "pending").length;
  const approved = tickets.filter((t) => t.status === "approved_for_signing" || (t.status === "approved_for_esigning" && t.confirmed_at)).length;
  const pendingSignatures = routes.filter((r) => !r.confirmed_at).length;
  const confirmedSignatures = routes.filter((r) => r.confirmed_at).length;
  const receivedEndorsements = endorsements.filter((e) => e.office_id === office.id);
  const pendingReceived = receivedEndorsements.filter((e) => e.status === "pending").length;
  const sentTotal = endorsements.filter((e) => e.source_office_id === office.id).length;
  const urgentAnnouncements = announcements.filter((a) => a.priority === "urgent").length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentAnnouncements = announcements.filter((a) => a.published_at && (parseDbDate(a.published_at)?.getTime() ?? 0) >= weekAgo).length;

  // Unread red counts — what arrived in each module since this office last opened it.
  const unread = await computeUnread(req.portalUser.id, {
    announcements: (seen) =>
      countSince(
        `SELECT COUNT(*) AS c FROM announcements
         WHERE status = 'published' AND JSON_CONTAINS(audience, JSON_QUOTE('offices'))
           AND COALESCE(published_at, created_at) > ?`,
        [seen]
      ),
    campusFeed: (seen) =>
      countSince(
        "SELECT COUNT(*) AS c FROM campus_feed_posts WHERE hidden = 0 AND created_at > ? AND (author_office_id IS NULL OR author_office_id <> ?)",
        [seen, office.id]
      ),
    // Documents other offices (or SAA) sent or asked this office for, and
    // answers that came back to a request this office made.
    documentRepository: async (seen) =>
      (await countSince(
        "SELECT COUNT(*) AS c FROM document_transmissions WHERE office_id = ? AND created_at > ?",
        [office.id, seen]
      )) +
      (await countSince(
        "SELECT COUNT(*) AS c FROM document_transmissions WHERE from_office_id = ? AND responded_at IS NOT NULL AND responded_at > ?",
        [office.id, seen]
      )),
    studentLeaders: (seen) =>
      countSince(
        `SELECT COUNT(*) AS c FROM organization_documents d
         JOIN student_organizations o ON o.id = d.organization_id
         WHERE d.hidden = 0 AND d.created_at > ? AND (o.office_id IS NULL OR o.office_id <> ?)`,
        [seen, office.id]
      ),
  });

  const conversation = await chatRepo.getConversationForUser(req.portalUser.id);
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

  const activity = [];
  if (actionNeeded > 0) {
    activity.push({
      id: "docs-action-needed",
      tone: "warning",
      message: `${actionNeeded} document request${actionNeeded === 1 ? "" : "s"} need your office's action.`,
      to: "/document-queue",
    });
  }
  if (pendingSignatures > 0) {
    activity.push({
      id: "signatures-pending",
      tone: "warning",
      message: `${pendingSignatures} document${pendingSignatures === 1 ? "" : "s"} waiting on your office's e-signature.`,
      to: "/document-queue",
    });
  }
  if (pendingReceived > 0) {
    activity.push({
      id: "endorsements-pending",
      tone: "info",
      message: `${pendingReceived} student endorsement${pendingReceived === 1 ? "" : "s"} awaiting your office's response.`,
      to: "/student-endorsement",
    });
  }
  if (urgentAnnouncements > 0) {
    activity.push({
      id: "announcements-urgent",
      tone: "danger",
      message: `${urgentAnnouncements} urgent announcement${urgentAnnouncements === 1 ? "" : "s"} from SAA.`,
      to: "/announcements",
    });
  }
  if (unreadFromSaa > 0) {
    activity.push({
      id: "chat-reply",
      tone: "info",
      message: `${unreadFromSaa} new message${unreadFromSaa === 1 ? "" : "s"} from the SAA office.`,
      to: "/saa-chat",
    });
  }

  res.json({
    office: { id: office.id, name: office.name, category: office.category },
    documents: { pending: pendingReview, actionNeeded, approved },
    signatures: { pending: pendingSignatures, confirmed: confirmedSignatures },
    endorsements: { pendingReceived, sentTotal },
    announcements: { recent: recentAnnouncements, urgent: urgentAnnouncements },
    chat: { unreadFromSaa },
    badges: {
      documentQueue: actionNeeded + pendingSignatures,
      saaChat: unreadFromSaa,
      endorsements: pendingReceived,
      ...unread.counts,
    },
    trackedBadges: unread.tracked,
    activity,
    recentTickets: tickets.slice(0, 5),
    recentEndorsements: endorsements.slice(0, 5),
  });
}

const SEEN_MODULES = ["announcements", "campusFeed", "documentRepository", "studentLeaders"];

export async function markSeen(req, res) {
  const key = String(req.body?.module || "");
  if (!SEEN_MODULES.includes(key)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Unknown module." });
  }
  await markModuleSeen(req.portalUser.id, key);
  res.json({ ok: true });
}
