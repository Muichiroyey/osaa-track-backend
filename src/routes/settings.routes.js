import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/settings.controller.js";

const router = Router();

router.get("/", requireAuth, ctrl.getSettings);
router.put("/", requireAuth, ctrl.updateSettings);
router.put("/profile", requireAuth, ctrl.updateProfile);
router.put("/logo", requireAuth, ctrl.updateLogo);
router.put("/password", requireAuth, ctrl.updatePassword);

export default router;
