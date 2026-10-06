import { pool } from "../config/db.js";
import { phDateKey, PH_TIME_ZONE } from "../config/timezone.js";

// Every function here runs a live aggregate query against the current
// database state — nothing is cached or pre-computed, so the Analytics
// panel always reflects whatever was just added, edited, or deleted in
// any other module.

const num = (v) => Number(v || 0);

function toLabelValue(rows, labelKey, valueKey = "value") {
  return rows.map((r) => ({ name: r[labelKey] ?? "Unspecified", value: num(r[valueKey]) }));
}

// Builds a continuous daily series for the last `days` days (filling in
// zero-count days) from a table's timestamp column, so line charts don't
// show gaps just because nothing happened on a given day.
async function dailySeries(table, dateColumn, days = 30) {
  const [rows] = await pool.query(
    `SELECT DATE(${dateColumn}) AS d, COUNT(*) AS c
     FROM ${table}
     WHERE ${dateColumn} >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(${dateColumn})`,
    [days - 1]
  );
  const byDate = new Map(rows.map((r) => [String(r.d), num(r.c)]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    // Calendar days in the Philippines (not UTC) so a record made at 1 AM
    // lands on today's bar, not yesterday's. PH has no daylight saving, so
    // stepping back whole 24-hour blocks always lands on the right date.
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = phDateKey(d);
    series.push({
      date: key,
      label: d.toLocaleDateString("en-US", { timeZone: PH_TIME_ZONE, month: "short", day: "numeric" }),
      value: byDate.get(key) || 0,
    });
  }
  return series;
}

export async function getAnalytics() {
  const [
    usersByType,
    usersByStatus,
    usersByDepartment,
    announcementsByStatus,
    announcementsByPriority,
    campusFeedTimeline,
    docQueueByStatus,
    docQueueTimeline,
    docQueueArchiveByCategory,
    filesByFolder,
    transmissionsByStatus,
    transmissionsByDirection,
    scholarshipsByStatus,
    applicantsByStatus,
    recipientsByStatus,
    achievementsByStatus,
    achievementsByCollege,
    jobsByStatus,
    jobsByIndustry,
    endorsementsByDirection,
    endorsementsByStatus,
    alumniByEmployment,
    alumniByProgram,
    officersByCategory,
    officersByOrganization,
    faqsByCategory,
    reportsByType,
    reportsTimeline,
    chatConversationsTimeline,
  ] = await Promise.all([
    pool.query(`SELECT type AS label, COUNT(*) AS value FROM users GROUP BY type`),
    pool.query(`SELECT status AS label, COUNT(*) AS value FROM users GROUP BY status`),
    pool.query(
      `SELECT COALESCE(NULLIF(department, ''), 'Unspecified') AS label, COUNT(*) AS value
       FROM users GROUP BY label ORDER BY value DESC LIMIT 8`
    ),
    pool.query(`SELECT status AS label, COUNT(*) AS value FROM announcements GROUP BY status`),
    pool.query(`SELECT priority AS label, COUNT(*) AS value FROM announcements GROUP BY priority`),
    dailySeries("campus_feed_posts", "created_at"),
    pool.query(`SELECT status AS label, COUNT(*) AS value FROM document_queue_tickets GROUP BY status`),
    dailySeries("document_queue_tickets", "submitted_at"),
    // Mirrors the Queuing Archive's four folder boxes exactly, so this
    // chart and that page never tell two different stories.
    pool.query(
      `SELECT
         SUM(status = 'rejected') AS rejected,
         SUM(status IN ('revision_requested', 'expired')) AS needs_revision,
         SUM(status = 'approved_for_esigning' AND confirmed_at IS NOT NULL) AS approved_esign,
         SUM(status = 'approved_for_signing') AS approved_physical
       FROM document_queue_tickets`
    ),
    pool.query(
      `SELECT f.name AS label, COUNT(df.id) AS value
       FROM document_folders f LEFT JOIN document_files df ON df.folder_id = f.id AND df.status = 'active'
       GROUP BY f.id, f.name ORDER BY f.name`
    ),
    pool.query(`SELECT status AS label, COUNT(*) AS value FROM document_transmissions GROUP BY status`),
    pool.query(`SELECT direction AS label, COUNT(*) AS value FROM document_transmissions GROUP BY direction`),
    pool.query(`SELECT status AS label, COUNT(*) AS value FROM scholarships GROUP BY status`),
    pool.query(`SELECT status AS label, COUNT(*) AS value FROM scholarship_applicants GROUP BY status`),
    pool.query(`SELECT status AS label, COUNT(*) AS value FROM scholarship_recipients GROUP BY status`),
    pool.query(`SELECT status AS label, COUNT(*) AS value FROM achievements GROUP BY status`),
    pool.query(`SELECT college AS label, COUNT(*) AS value FROM achievements GROUP BY college ORDER BY value DESC`),
    pool.query(`SELECT status AS label, COUNT(*) AS value FROM job_postings GROUP BY status`),
    pool.query(
      `SELECT COALESCE(NULLIF(industry, ''), 'Unspecified') AS label, COUNT(*) AS value
       FROM job_postings GROUP BY label ORDER BY value DESC`
    ),
    pool.query(`SELECT direction AS label, COUNT(*) AS value FROM endorsements GROUP BY direction`),
    pool.query(`SELECT status AS label, COUNT(*) AS value FROM endorsements GROUP BY status`),
    pool.query(
      `SELECT COALESCE(NULLIF(employment_status, ''), 'Unspecified') AS label, COUNT(*) AS value
       FROM alumni_profiles GROUP BY label`
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(program, ''), 'Unspecified') AS label, COUNT(*) AS value
       FROM alumni_profiles GROUP BY label ORDER BY value DESC LIMIT 8`
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(category, ''), 'Unspecified') AS label, COUNT(*) AS value
       FROM org_officers GROUP BY label ORDER BY value DESC`
    ),
    pool.query(
      `SELECT so.name AS label, COUNT(oo.id) AS value
       FROM student_organizations so LEFT JOIN org_officers oo ON oo.organization_id = so.id
       GROUP BY so.id, so.name ORDER BY value DESC LIMIT 10`
    ),
    pool.query(`SELECT category AS label, COUNT(*) AS value FROM faqs GROUP BY category ORDER BY value DESC`),
    pool.query(`SELECT report_key AS label, COUNT(*) AS value FROM generated_reports GROUP BY report_key ORDER BY value DESC`),
    dailySeries("generated_reports", "generated_at"),
    dailySeries("chat_conversations", "created_at"),
  ]);

  const archiveRow = docQueueArchiveByCategory[0][0] || {};
  const archiveLabels = {
    rejected: "Rejected",
    needs_revision: "Needs Revision",
    approved_esign: "Approved (E-Signing)",
    approved_physical: "Approved (Physical)",
  };

  return {
    userManagement: {
      byType: toLabelValue(usersByType[0], "label"),
      byStatus: toLabelValue(usersByStatus[0], "label"),
      byDepartment: toLabelValue(usersByDepartment[0], "label"),
    },
    announcements: {
      byStatus: toLabelValue(announcementsByStatus[0], "label"),
      byPriority: toLabelValue(announcementsByPriority[0], "label"),
    },
    campusFeed: {
      postsTimeline: campusFeedTimeline,
    },
    documentQueue: {
      byStatus: toLabelValue(docQueueByStatus[0], "label"),
      requestsTimeline: docQueueTimeline,
      archiveByCategory: Object.entries(archiveLabels).map(([key, name]) => ({ name, value: num(archiveRow[key]) })),
    },
    documentRepository: {
      filesByFolder: toLabelValue(filesByFolder[0], "label"),
      transmissionsByStatus: toLabelValue(transmissionsByStatus[0], "label"),
      transmissionsByDirection: toLabelValue(transmissionsByDirection[0], "label"),
    },
    scholarships: {
      byStatus: toLabelValue(scholarshipsByStatus[0], "label"),
      applicantsByStatus: toLabelValue(applicantsByStatus[0], "label"),
      recipientsByStatus: toLabelValue(recipientsByStatus[0], "label"),
    },
    achievements: {
      byStatus: toLabelValue(achievementsByStatus[0], "label"),
      byCollege: toLabelValue(achievementsByCollege[0], "label"),
    },
    jobPostings: {
      byStatus: toLabelValue(jobsByStatus[0], "label"),
      byIndustry: toLabelValue(jobsByIndustry[0], "label"),
    },
    studentEndorsement: {
      byDirection: toLabelValue(endorsementsByDirection[0], "label"),
      byStatus: toLabelValue(endorsementsByStatus[0], "label"),
    },
    alumniProfiles: {
      byEmploymentStatus: toLabelValue(alumniByEmployment[0], "label"),
      byProgram: toLabelValue(alumniByProgram[0], "label"),
    },
    studentLeaders: {
      officersByCategory: toLabelValue(officersByCategory[0], "label"),
      officersByOrganization: toLabelValue(officersByOrganization[0], "label"),
    },
    faq: {
      byCategory: toLabelValue(faqsByCategory[0], "label"),
    },
    reports: {
      byType: toLabelValue(reportsByType[0], "label"),
      timeline: reportsTimeline,
    },
    saaChat: {
      conversationsTimeline: chatConversationsTimeline,
    },
  };
}
