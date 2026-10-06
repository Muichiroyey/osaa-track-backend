import * as repo from "../repositories/chatRepo.js";

export async function listContacts(req, res) {
  const items = await repo.listContacts(req.query.search);
  res.json({ items });
}

export async function listConversations(req, res) {
  const items = await repo.listConversations();
  res.json({ items });
}

// Get-or-create — starting a conversation from the contact list just
// opens the existing thread if the admin already messaged that person
// before, instead of creating duplicates.
export async function openConversation(req, res) {
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: "VALIDATION_ERROR", message: "A contact is required." });
  const user = await repo.getUser(userId);
  if (!user) return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  const id = await repo.findOrCreateConversation(userId);
  const conversation = await repo.getConversation(id);
  res.status(201).json({ conversation });
}

export async function listMessages(req, res) {
  const conversation = await repo.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  const afterId = parseInt(req.query.afterId, 10) || 0;
  const items = await repo.listMessages(req.params.id, afterId);
  res.json({ conversation, items });
}

// Every message sent from this admin panel is sender_type "admin" — the
// "user" side only ever appears once a future student/alumni/staff/office
// portal exists to actually reply from (see Phase 1 note in the repo's
// docs); demo contacts never send anything back on their own.
export async function sendMessage(req, res) {
  const conversation = await repo.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: "NOT_FOUND", message: "Conversation not found." });
  const { body, fileId } = req.body || {};
  if (!body?.trim() && !fileId) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Type a message or attach a file." });
  }
  // An SAA Staff member answering from the staff portal is recorded by id
  // (sender_user_id) so the thread shows who replied; the other side still
  // sees it as coming from the SAA office.
  const message = await repo.createMessage({ conversationId: req.params.id, senderType: "admin", body: body?.trim(), fileId, senderUserId: req.staffUser?.id ?? null });
  res.status(201).json({ message });
}

// Unsend one of the admin's own messages. Only messages sent from this
// panel (sender_type "admin") can be unsent here — never a contact's — and
// the message must belong to the conversation in the URL. There's no time
// limit: chat history is permanent, and unsending is the admin's own way
// to take a message back.
export async function unsendMessage(req, res) {
  const message = await repo.getMessage(req.params.messageId);
  if (!message || String(message.conversation_id) !== String(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Message not found." });
  }
  if (message.sender_type !== "admin") {
    return res.status(403).json({ error: "FORBIDDEN", message: "You can only unsend messages you sent." });
  }
  // A staff member may only take back their OWN messages, not the Dean's or a
  // colleague's.
  if (req.staffUser && message.sender_user_id !== req.staffUser.id) {
    return res.status(403).json({ error: "FORBIDDEN", message: "You can only unsend messages you sent." });
  }
  const updated = await repo.unsendMessage(message.id);
  res.json({ message: { ...updated, file: null } });
}
