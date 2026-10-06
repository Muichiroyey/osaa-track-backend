import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/reports.controller.js";

const router = Router();

router.get("/definitions", requireAuth, ctrl.listDefinitions);
router.get("/lookup/:source", requireAuth, ctrl.lookupOptions);
router.post("/generate", requireAuth, ctrl.generate);
router.get("/history", requireAuth, ctrl.listHistory);
router.delete("/history/:id", requireAuth, ctrl.deleteHistory);

export default router;
