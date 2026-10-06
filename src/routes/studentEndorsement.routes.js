import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/studentEndorsement.controller.js";

const router = Router();
router.get("/", requireAuth, ctrl.list);
router.post("/", requireAuth, ctrl.create);
router.post("/:id/files", requireAuth, ctrl.addFile);
router.patch("/:id/status", requireAuth, ctrl.updateStatus);

export default router;
