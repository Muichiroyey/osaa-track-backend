import { getFiles } from "../repositories/uploadedFileRepo.js";

/**
 * "Can this portal user attach these files to something?"
 * ───────────────────────────────────────────────────────────────────────
 * Anything a person attaches (a Campus Feed photo, a chat attachment, a
 * logo) later becomes visible to other people through that post/message/
 * profile. So a portal user may only attach files THEY uploaded — never an
 * arbitrary file id, which would otherwise be a way to expose someone
 * else's private upload by attaching it to something public.
 *
 * Returns null when everything is fine, otherwise a message for the user.
 *   ids          — file ids being attached
 *   userId       — the signed-in portal user
 *   alreadyOwned — ids that are legitimately already attached to the thing
 *                  being edited (so re-saving an unchanged logo still works)
 *   imagesOnly   — also require an image mime type (logos, photos)
 */
export async function checkAttachableFiles(ids, userId, { alreadyOwned = [], imagesOnly = false } = {}) {
  const wanted = [...new Set((ids || []).filter((v) => v != null && v !== "").map(Number))];
  if (wanted.length === 0) return null;
  if (wanted.some((n) => !Number.isInteger(n))) return "One or more attached files could not be found.";

  const keep = new Set((alreadyOwned || []).filter(Boolean).map(Number));
  const files = await getFiles(wanted);
  if (files.length !== wanted.length) return "One or more attached files could not be found.";

  for (const f of files) {
    if (!keep.has(f.id) && f.uploaded_by_user_id !== userId) {
      return "One or more attached files could not be used. Please upload them again.";
    }
    if (imagesOnly && !String(f.mime_type || "").toLowerCase().startsWith("image/")) {
      return "Please choose an image file (JPG, PNG, WEBP, GIF).";
    }
  }
  return null;
}
