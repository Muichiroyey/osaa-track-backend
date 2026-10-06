import * as repo from "../repositories/announcementRepo.js";
import { getEmailsForAudience } from "../repositories/userRepo.js";
import { sendBulkEmail, isEmailConfigured } from "../config/email.js";

const VALID_PRIORITY = new Set(["normal", "urgent"]);
const VALID_AUDIENCE = new Set(["students", "alumni", "offices"]);

function validate(body) {
  if (!body.title || !body.title.trim()) return "Title is required.";
  if (!body.body || !body.body.trim()) return "Announcement content is required.";
  if (body.priority && !VALID_PRIORITY.has(body.priority)) return "Priority must be normal or urgent.";
  if (!Array.isArray(body.audience) || body.audience.length === 0) return "Select at least one target audience.";
  if (body.audience.some((a) => !VALID_AUDIENCE.has(a))) return "Invalid audience value.";
  return null;
}

async function notifyAudience(announcement) {
  const emails = await getEmailsForAudience(announcement.audience);
  const result = await sendBulkEmail({
    recipients: emails,
    subject: `[OSAA-TRACK] ${announcement.title}`,
    text: announcement.body,
    html: `<div style="font-family:sans-serif;max-width:560px">
      <p style="text-transform:uppercase;letter-spacing:1px;font-size:11px;color:${announcement.priority === "urgent" ? "#dc2626" : "#64748b"};font-weight:bold;">
        ${announcement.priority === "urgent" ? "Urgent Announcement" : "Announcement"} &middot; OSAA-TRACK
      </p>
      <h2 style="margin:4px 0 12px;color:#1e293b;">${announcement.title}</h2>
      <p style="white-space:pre-wrap;color:#334155;line-height:1.6;">${announcement.body}</p>
      <p style="margin-top:24px;font-size:12px;color:#94a3b8;">Office of Student and Alumni Affairs &middot; Pangasinan State University &ndash; Lingayen Campus</p>
    </div>`,
  });
  return result;
}

export async function list(req, res) {
  const items = await repo.listAnnouncements({ status: req.query.status, search: req.query.search });
  res.json({ items });
}

export async function getOne(req, res) {
  const item = await repo.getAnnouncement(req.params.id);
  if (!item) return res.status(404).json({ error: "NOT_FOUND", message: "Announcement not found." });
  res.json({ item });
}

export async function create(req, res) {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });

  const id = await repo.createAnnouncement({
    title: req.body.title.trim(),
    body: req.body.body.trim(),
    priority: req.body.priority || "normal",
    audience: req.body.audience,
    attachmentIds: req.body.attachmentIds || [],
    asDraft: Boolean(req.body.asDraft),
  });
  const item = await repo.getAnnouncement(id);

  let emailResult = null;
  if (item.status === "published") emailResult = await notifyAudience(item);

  res.status(201).json({
    item,
    emailNotified: emailResult?.sent || 0,
    emailConfigured: isEmailConfigured(),
    emailError: emailResult?.error || null,
  });
}

export async function update(req, res) {
  const existing = await repo.getAnnouncement(req.params.id);
  if (!existing) return res.status(404).json({ error: "NOT_FOUND", message: "Announcement not found." });

  const error = validate(req.body);
  if (error) return res.status(400).json({ error: "VALIDATION_ERROR", message: error });

  await repo.updateAnnouncement(req.params.id, {
    title: req.body.title.trim(),
    body: req.body.body.trim(),
    priority: req.body.priority || "normal",
    audience: req.body.audience,
    attachmentIds: req.body.attachmentIds || existing.attachments.map((a) => a.id),
  });
  const item = await repo.getAnnouncement(req.params.id);
  res.json({ item });
}

export async function publish(req, res) {
  const wasAlreadyPublished = (await repo.getAnnouncement(req.params.id))?.status === "published";
  const ok = await repo.publishAnnouncement(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Announcement not found." });
  const item = await repo.getAnnouncement(req.params.id);

  let emailResult = null;
  if (!wasAlreadyPublished) emailResult = await notifyAudience(item);

  res.json({
    item,
    emailNotified: emailResult?.sent || 0,
    emailConfigured: isEmailConfigured(),
    emailError: emailResult?.error || null,
  });
}

export async function archive(req, res) {
  const ok = await repo.setAnnouncementStatus(req.params.id, "archived");
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Announcement not found." });
  res.json({ message: "Announcement archived." });
}

export async function remove(req, res) {
  const ok = await repo.deleteAnnouncement(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Announcement not found." });
  res.json({ message: "Announcement deleted." });
}
