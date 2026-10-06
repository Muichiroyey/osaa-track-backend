import * as campusFeedRepo from "../repositories/campusFeedRepo.js";
import { checkAttachableFiles } from "../services/fileOwnership.js";
import { getOfficeByUserId } from "../repositories/officeRepo.js";

/**
 * CAMPUS FEED — OFFICE PORTAL (spec section 3)
 * "Office Interaction: VIEW / POST / MANAGE OWN POSTS" — viewing the
 * shared feed itself is identical to the Student/Alumni Portal's read-only
 * version (portalContent.listCampusFeed, reused directly in office.routes.js).
 * This file is only the part that's new: authoring, hiding, and deleting a
 * post this office's own account created.
 */

async function requireOffice(req, res) {
  const office = await getOfficeByUserId(req.portalUser.id);
  if (!office) {
    res.status(403).json({ error: "NO_OFFICE_LINKED", message: "This account isn't linked to an authorized office." });
    return null;
  }
  return office;
}

// "Manage own posts" — every post this office has ever made, hidden ones
// included, so it can unhide them (spec step 5).
export async function listMyPosts(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  res.json({ items: await campusFeedRepo.listPostsForOffice(office.id) });
}

export async function createPost(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const body = (req.body?.body || "").trim();
  const title = (req.body?.title || "").trim();
  const mediaFileIds = Array.isArray(req.body?.mediaFileIds) ? req.body.mediaFileIds : [];
  if (!title) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Add a title for the post." });
  if (!body) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Write the content of the post before submitting." });
  if (mediaFileIds.length > 0) {
    // Photos and documents are both allowed as attachments.
    const problem = await checkAttachableFiles(mediaFileIds, req.portalUser.id);
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
  }
  const id = await campusFeedRepo.createPost({ title, body, mediaFileIds, authorType: "office", authorOfficeId: office.id });
  const item = await campusFeedRepo.getPost(id);
  res.status(201).json({ item });
}

// Edit a post this office made: title, content and attachments.
export async function updatePost(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const post = await campusFeedRepo.getPost(req.params.id);
  if (!post || post.author_type !== "office" || post.author_office_id !== office.id) {
    return res.status(404).json({ error: "NOT_FOUND", message: "You can only edit your own office's posts." });
  }
  const title = (req.body?.title || "").trim();
  const body = (req.body?.body || "").trim();
  const mediaFileIds = Array.isArray(req.body?.mediaFileIds) ? req.body.mediaFileIds : [];
  if (!title) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Add a title for the post." });
  if (!body) return res.status(400).json({ error: "VALIDATION_ERROR", message: "Write the content of the post before saving." });
  if (mediaFileIds.length > 0) {
    // Files already on the post stay valid even if another account uploaded them.
    const problem = await checkAttachableFiles(mediaFileIds, req.portalUser.id, { alreadyOwned: (post.media || []).map((m) => m.id) });
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: problem });
  }
  await campusFeedRepo.updatePost(post.id, { title, body, mediaFileIds });
  res.json({ item: await campusFeedRepo.getPost(post.id) });
}

export async function setHidden(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const hidden = Boolean(req.body?.hidden);
  const ok = await campusFeedRepo.setPostHiddenForOffice(req.params.id, office.id, hidden);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "You can only hide or unhide your own office's posts." });
  res.json({ message: hidden ? "Post hidden." : "Post unhidden." });
}

export async function deletePost(req, res) {
  const office = await requireOffice(req, res);
  if (!office) return;
  const ok = await campusFeedRepo.deletePostForOffice(req.params.id, office.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "You can only delete your own office's posts." });
  res.json({ message: "Post deleted." });
}
