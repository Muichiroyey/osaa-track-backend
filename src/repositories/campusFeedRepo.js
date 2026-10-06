import { pool } from "../config/db.js";
import { getFiles } from "./uploadedFileRepo.js";
import { getAdminAvatarFileId } from "./adminRepo.js";

// What an admin-authored post is credited to. The admin account IS the SAA
// office, so this is the one place that name lives — every portal renders
// whatever `author_name` the API returns instead of hardcoding it.
export const SAA_OFFICE_NAME = "Office of Student and Alumni Affairs";

// One SELECT shared by every read so each post always carries the same
// author fields: the posting office's row, plus the logo that office set in
// its Settings page (users.avatar_file_id of its login account).
const POST_SELECT = `SELECT p.*, o.name AS author_office_name, ou.avatar_file_id AS author_office_logo_id
     FROM campus_feed_posts p
     LEFT JOIN offices o ON o.id = p.author_office_id
     LEFT JOIN users ou ON ou.id = o.user_id`;

// Adds who the post is "from" in display terms:
//   author_name — the posting office's real name, or the SAA office's name
//                 for a post the admin made
//   author_logo — {id} of that author's logo (an office's Settings logo, or
//                 the admin's Settings logo), or null when none is set so
//                 the client can fall back to the SAA seal / initials
async function attachAuthor(rows) {
  if (rows.length === 0) return rows;
  const adminLogoId = await getAdminAvatarFileId();
  return rows.map(({ author_office_logo_id, ...p }) => {
    const isOffice = p.author_type === "office";
    const logoId = isOffice ? author_office_logo_id : adminLogoId;
    return {
      ...p,
      author_name: isOffice ? p.author_office_name || "Campus Office" : SAA_OFFICE_NAME,
      author_logo: logoId ? { id: logoId } : null,
    };
  });
}

async function attachMedia(rows) {
  return Promise.all(rows.map(async (p) => {
    const [mediaLinks] = await pool.query(
      "SELECT file_id FROM campus_feed_media WHERE post_id = ? ORDER BY sort_order ASC, id ASC",
      [p.id]
    );
    const media = await getFiles(mediaLinks.map((m) => m.file_id));
    // getFiles doesn't preserve order — re-sort to match the link order
    const order = mediaLinks.map((m) => m.file_id);
    media.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { ...p, media };
  }));
}

// Both steps every read needs: the post's photos, and who it is from.
async function hydrate(rows) {
  return attachMedia(await attachAuthor(rows));
}

// includeHidden: the Admin Panel sees everything (oversight); every other
// reader (Office Portal feed, future student/alumni feed) only sees what's
// currently visible — a hidden post (spec section 3 step 5) drops out of
// the shared feed for everyone except its own author's "My Posts" list.
export async function listPosts({ includeHidden = true } = {}) {
  const where = includeHidden ? "" : "WHERE p.hidden = 0";
  const [rows] = await pool.query(`${POST_SELECT} ${where} ORDER BY p.created_at DESC, p.id DESC`);
  return hydrate(rows);
}

// An office's own posting history for its "manage own posts" view —
// includes its hidden posts too, so it can unhide them.
export async function listPostsForOffice(officeId) {
  const [rows] = await pool.query(
    `${POST_SELECT} WHERE p.author_office_id = ? ORDER BY p.created_at DESC, p.id DESC`,
    [officeId]
  );
  return hydrate(rows);
}

export async function getPost(id) {
  const [rows] = await pool.query(`${POST_SELECT} WHERE p.id = ?`, [id]);
  if (!rows[0]) return null;
  const [attached] = await hydrate(rows);
  return attached;
}

async function setMedia(postId, fileIds) {
  await pool.query("DELETE FROM campus_feed_media WHERE post_id = ?", [postId]);
  if (fileIds && fileIds.length > 0) {
    const values = fileIds.map((fileId, i) => [postId, fileId, i]);
    await pool.query("INSERT INTO campus_feed_media (post_id, file_id, sort_order) VALUES ?", [values]);
  }
}

export async function createPost({ title, body, mediaFileIds, authorType = "admin", authorOfficeId = null }) {
  const [result] = await pool.query(
    "INSERT INTO campus_feed_posts (title, body, author_type, author_office_id) VALUES (?, ?, ?, ?)",
    [title || null, body, authorType, authorOfficeId]
  );
  await setMedia(result.insertId, mediaFileIds);
  return result.insertId;
}

export async function updatePost(id, { title, body, mediaFileIds }) {
  const [result] = await pool.query(
    "UPDATE campus_feed_posts SET title = ?, body = ? WHERE id = ?",
    [title || null, body, id]
  );
  await setMedia(id, mediaFileIds);
  return result.affectedRows > 0;
}

export async function deletePost(id) {
  const [result] = await pool.query("DELETE FROM campus_feed_posts WHERE id = ?", [id]);
  return result.affectedRows > 0;
}

// Office Portal — "manage own posts" (spec section 3 step 5): can hide,
// unhide, or delete only a post it authored itself.
export async function setPostHiddenForOffice(id, officeId, hidden) {
  const [result] = await pool.query(
    "UPDATE campus_feed_posts SET hidden = ? WHERE id = ? AND author_office_id = ?",
    [hidden ? 1 : 0, id, officeId]
  );
  return result.affectedRows > 0;
}

export async function deletePostForOffice(id, officeId) {
  const [result] = await pool.query(
    "DELETE FROM campus_feed_posts WHERE id = ? AND author_office_id = ?",
    [id, officeId]
  );
  return result.affectedRows > 0;
}
