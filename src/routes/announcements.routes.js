import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { list, getOne, create, update, publish, archive, remove } from "../controllers/announcements.controller.js";

const router = Router();

router.get("/", requireAuth, list);
router.get("/:id", requireAuth, getOne);
router.post("/", requireAuth, create);
router.put("/:id", requireAuth, update);
router.patch("/:id/publish", requireAuth, publish);
router.patch("/:id/archive", requireAuth, archive);
router.delete("/:id", requireAuth, remove);

export default router;
