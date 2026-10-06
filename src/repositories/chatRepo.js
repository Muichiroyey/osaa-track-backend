import { pool } from "../config/db.js";
import fs from "node:fs";
import path from "node:path";
import { getFile } from "./uploadedFileRepo.js";
import { UPLOAD_DIR } from "../middleware/upload.js";

// Contacts the admin can message — every directory user (student, alumni,
// staff, offices), optionally filtered by a search term. Demo contacts
// (is_demo = 1) are flagged so the UI can badge them clearly.
export async function listContacts(search) {
  const term = (search || "").trim();
  const params = [];
  let where = "";
  if (term) {
    where = "WHERE name LIKE ? OR email LIKE ? OR code LIKE ?";
    params.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }
  const [rows] = await pool.query(
    `SELECT id, code, name, email, type, is_demo FROM users ${where} ORDER BY is_demo DESC, name LIMIT 100`,
    params
  );
  return rows;
}

export async function getUser(id) {
  const [rows] = await pool.query("SELECT id, code, name, email, type, is_demo FROM users WHERE id = ?", [id]);
  return rows[0] || null;
}

// One conversation per (admin, other user) — there's only a single admin
// account in this phase, so the other participant alone identifies it.
export async function findOrCreateConversation(otherUserId) {
  const [existing] = await pool.query("SELECT id FROM chat_conversations WHERE other_user_id = ?", [otherUserId]);
  if (existing[0]) return existing[0].id;
  const [result] = await pool.query("INSERT INTO chat_conversations (other_user_id) VALUES (?)", [otherUserId]);
  return result.insertId;
}

export async function getConversation(id) {
  const [rows] = await pool.query(
    `SELECT c.id, c.other_user_id, c.created_at, c.last_message_at, u.name AS user_name, u.email AS user_email, u.type AS user_type, u.is_demo
     FROM chat_conversations c JOIN users u ON u.id = c.other_user_id
     WHERE c.id = ?`,
    [id]
  );
  return rows[0] || null;
}

// Conversation list, newest activity first, with each one's latest
// message as a preview snippet. Chat history is permanent, so this looks
// at every message; an unsent one still counts as the latest (the preview
// then reads "You unsent a message" instead of showing its old content).
export async function listConversations() {
  const [rows] = await pool.query(
    `SELECT c.id, c.other_user_id, c.last_message_at, u.name AS user_name, u.email AS user_email, u.type AS user_type, u.is_demo,
            (SELECT body FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
            (SELECT file_id FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_file_id,
            (SELECT f.mime_type FROM chat_messages m JOIN uploaded_files f ON f.id = m.file_id WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_file_mime,
            (SELECT sender_type FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender_type,
            (SELECT unsent_at FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_unsent_at
     FROM chat_conversations c JOIN users u ON u.id = c.other_user_id
     ORDER BY c.last_message_at DESC`
  );
  return rows;
}

// Messages are permanent — nothing here ages out. An unsent message stays
// in the list as a placeholder (its body and file were wiped when it was
// unsent, so `body` and `file` come back empty and `unsent_at` is set),
// which keeps the conversation's order and context intact.
export async function listMessages(conversationId, afterId = 0) {
  const [rows] = await pool.query(
    `SELECT m.id, m.conversation_id, m.sender_type, m.body, m.file_id, m.created_at, m.unsent_at, m.sender_user_id,
            (SELECT u.name FROM users u WHERE u.id = m.sender_user_id) AS sender_name
     FROM chat_messages m
     WHERE m.conversation_id = ? AND m.id > ?
     ORDER BY m.id ASC`,
    [conversationId, afterId]
  );
  const files = await Promise.all(rows.filter((r) => r.file_id).map((r) => getFile(r.file_id)));
  const fileMap = new Map(files.filter(Boolean).map((f) => [f.id, f]));
  return rows.map((r) => ({ ...r, file: r.file_id ? fileMap.get(r.file_id) || null : null }));
}

export async function createMessage({ conversationId, senderType, body, fileId, senderUserId = null }) {
  const [result] = await pool.query(
    `INSERT INTO chat_messages (conversation_id, sender_type, body, file_id, sender_user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [conversationId, senderType, body || null, fileId || null, senderUserId]
  );
  await pool.query("UPDATE chat_conversations SET last_message_at = NOW() WHERE id = ?", [conversationId]);
  const [rows] = await pool.query(
    "SELECT id, conversation_id, sender_type, body, file_id, created_at, unsent_at, sender_user_id FROM chat_messages WHERE id = ?",
    [result.insertId]
  );
  const row = rows[0];
  if (row.file_id) row.file = await getFile(row.file_id);
  return row;
}

export async function getMessage(id) {
  const [rows] = await pool.query(
    "SELECT id, conversation_id, sender_type, body, file_id, created_at, unsent_at, sender_user_id FROM chat_messages WHERE id = ?",
    [id]
  );
  return rows[0] || null;
}

// Unsend = the message is removed from the conversation but its row stays,
// so the thread keeps its order and the other side sees "message unsent"
// rather than a silent gap. The text is cleared and any attached file is
// detached and deleted (both the uploaded_files row and the file on disk),
// so nothing of the original content is left behind. Unsending twice is a
// harmless no-op (the WHERE unsent_at IS NULL guard).
export async function unsendMessage(id) {
  const message = await getMessage(id);
  if (!message) return null;
  if (message.unsent_at) return message;

  await pool.query("UPDATE chat_messages SET body = NULL, file_id = NULL, unsent_at = NOW() WHERE id = ? AND unsent_at IS NULL", [id]);

  if (message.file_id) {
    const file = await getFile(message.file_id);
    if (file) {
      await pool.query("DELETE FROM uploaded_files WHERE id = ?", [file.id]);
      fs.promises.unlink(path.join(UPLOAD_DIR, file.stored_name)).catch(() => {}); // best-effort; a missing file is fine
    }
  }

  return getMessage(id);
}

// ── Student / Alumni Portal ─────────────────────────────────────────────
// A portal user has exactly one thread: theirs with the SAA office. The
// conversation is identified by their own user id (chat_conversations
// .other_user_id is UNIQUE), so there's nothing to pick from a list and no
// way to open anyone else's.
export async function getConversationForUser(userId) {
  const [rows] = await pool.query(
    "SELECT id, other_user_id, created_at, last_message_at FROM chat_conversations WHERE other_user_id = ?",
    [userId]
  );
  return rows[0] || null;
}

// Guard used before every portal read/write on a conversation id.
export async function conversationBelongsToUser(conversationId, userId) {
  const [rows] = await pool.query(
    "SELECT id FROM chat_conversations WHERE id = ? AND other_user_id = ? LIMIT 1",
    [conversationId, userId]
  );
  return rows.length > 0;
}
