import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/chat.controller.js";

const router = Router();

router.get("/contacts", requireAuth, ctrl.listContacts);
router.get("/conversations", requireAuth, ctrl.listConversations);
router.post("/conversations", requireAuth, ctrl.openConversation);
router.get("/conversations/:id/messages", requireAuth, ctrl.listMessages);
router.post("/conversations/:id/messages", requireAuth, ctrl.sendMessage);
router.post("/conversations/:id/messages/:messageId/unsend", requireAuth, ctrl.unsendMessage);

export default router;
