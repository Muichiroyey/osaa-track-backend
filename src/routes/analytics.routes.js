import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/analytics.controller.js";

const router = Router();
router.get("/", requireAuth, ctrl.getAnalytics);

export default router;
