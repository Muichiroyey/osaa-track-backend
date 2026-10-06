import * as repo from "../repositories/chatRepo.js";
import { checkAttachableFiles } from "../services/fileOwnership.js";

/**
 * SAA CHAT — USER SIDE
 * ───────────────────────────────────────────────────────────────────────
 * This is the endpoint the Admin Panel's README anticipated: "nothing
 * about the schema needs to change when that portal exists, only a new
 * authenticated endpoint that also calls the same createMessage function
 * with sender_type: 'user'." That's exactly what this is — the same
 * chat_conversations / chat_messages tables, the same upload pipeline for
 * attachments, the same unsend semantics.
 *
 * A portal user has exactly one thread (theirs with the SAA office), so
 * there's no conversation list and no contact picker: the conversation is
 * found or created from their own user id. Every write re-checks that the
 * conversation belongs to them.
 */

export async function getConversation(req, res) {
  // Get-or-create, so a student who has never messaged the office can
  // still open the page and type — the thread simply starts empty and the
  // admin sees it in their conversation list as soon as a message lands.
  const id = await repo.findOrCreateConversation(req.portalUser.id);
  const conversation = await repo.getConversation(id);
  res.json({
    conversation: {
      id: conversation.id,
      createdAt: conversation.created_at,
      lastMessageAt: conversation.last_message_at,
    },
  });
}

export async function listMessages(req, res) {
  if (!(await repo.conversationBelongsToUser(req.params.id, req.portalUser.id))) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }
  const afterId = parseInt(req.query.afterId, 10) || 0;
  const items = await repo.listMessages(req.params.id, afterId);
  res.json({ items });
}

export async function sendMessage(req, res) {
  if (!(await repo.conversationBelongsToUser(req.params.id, req.portalUser.id))) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }
  const { body, fileId } = req.body || {};
  if (!body?.trim() && !fileId) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Type a message or attach a file." });
  }
  if (fileId) {
    const problem = await checkAttachableFiles([fileId], req.portalUser.id);
    if (problem) return res.status(400).json({ error: "VALIDATION_ERROR", message: "That attachment could not be used. Please attach it again." });
  }

  // sender_type 'user' — the other half of the enum the admin side has
  // always written 'admin' into.
  const message = await repo.createMessage({
    conversationId: req.params.id,
    senderType: "user",
    body: body?.trim(),
    fileId,
  });
  res.status(201).json({ message });
}

/**
 * Unsend, mirroring the admin's rule exactly: you may only unsend your own
 * messages. Here that means sender_type 'user' — a message from the SAA
 * office is rejected with a 403, the same way the admin is rejected when
 * trying to unsend a contact's message.
 */
export async function unsendMessage(req, res) {
  if (!(await repo.conversationBelongsToUser(req.params.id, req.portalUser.id))) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  }
  const message = await repo.getMessage(req.params.messageId);
  if (!message || String(message.conversation_id) !== String(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }
  if (message.sender_type !== "user") {
    return res.status(403).json({ error: "FORBIDDEN", message: "You can only unsend messages you sent." });
  }
  const updated = await repo.unsendMessage(message.id);
  res.json({ message: { ...updated, file: null } });
}
