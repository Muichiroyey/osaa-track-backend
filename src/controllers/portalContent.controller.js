import * as announcementRepo from "../repositories/announcementRepo.js";
import * as campusFeedRepo from "../repositories/campusFeedRepo.js";
import * as faqRepo from "../repositories/faqRepo.js";
import * as jobRepo from "../repositories/jobPostingRepo.js";
import * as leadersRepo from "../repositories/studentLeadersRepo.js";

/**
 * Read-only content the Admin Panel publishes. Every handler here is a
 * GET — nothing in this file can create, edit or delete anything, which
 * matches both feature documents ("VIEW / READ ONLY" for announcements,
 * jobs, FAQ, campus feed and the leaders directory). Visibility rules
 * (published-only, audience-matched, active-only) are applied in SQL by
 * the repositories, not hidden in the UI.
 */

function audienceKeyFor(user) {
  return { student: "students", alumni: "alumni", offices: "offices" }[user.type] || user.type;
}

// ── Announcements ───────────────────────────────────────────────────────
export async function listAnnouncements(req, res) {
  const items = await announcementRepo.listPublishedForAudience(audienceKeyFor(req.portalUser));
  res.json({ items });
}

export async function getAnnouncement(req, res) {
  const item = await announcementRepo.getPublishedForAudience(req.params.id, audienceKeyFor(req.portalUser));
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Announcement not found." });
  res.json({ item });
}

// ── Campus Feed (students) ──────────────────────────────────────────────
export async function listCampusFeed(req, res) {
  res.json({ items: await campusFeedRepo.listPosts({ includeHidden: false }) });
}

// ── FAQ ─────────────────────────────────────────────────────────────────
export async function listFaqs(req, res) {
  const items = await faqRepo.listFaqs();
  const categories = [...new Set(items.map((f) => f.category))];
  res.json({ items, categories });
}

// ── Job Opportunities (alumni) ──────────────────────────────────────────
export async function listJobs(req, res) {
  res.json({ items: await jobRepo.listActiveJobPostings() });
}

export async function getJob(req, res) {
  const item = await jobRepo.getActiveJobPosting(req.params.id);
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "This job posting is no longer available." });
  res.json({ item });
}

// ── Student Leaders Directory (students) ────────────────────────────────
export async function listOrganizations(req, res) {
  res.json({ items: await leadersRepo.listOrganizations() });
}

// One organization with everything the directory page shows: its logos,
// its officers, the "connected to" links, and its documents. Assembled
// server-side so the page is one request instead of four.
export async function getOrganization(req, res) {
  const organization = await leadersRepo.getOrganization(req.params.id);
  if (!organization) return res.status(404).json({ error: "NOT_FOUND", message: "Organization not found." });

  const [officers, connections, documents] = await Promise.all([
    leadersRepo.listOfficers(req.params.id),
    leadersRepo.getConnectionsForOrg(req.params.id),
    leadersRepo.listOrganizationDocuments(req.params.id, { includeHidden: false }),
  ]);

  res.json({ organization, officers, connections, documents });
}
