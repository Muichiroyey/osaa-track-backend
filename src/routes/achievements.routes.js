import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/achievements.controller.js";

const router = Router();

router.get("/", requireAuth, ctrl.list);
router.get("/programs", requireAuth, ctrl.programs);
router.post("/", requireAuth, ctrl.create);
router.post("/:id/files", requireAuth, ctrl.addFile);
router.patch("/:id/decide", requireAuth, ctrl.decide);

export default router;
