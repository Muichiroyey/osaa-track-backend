import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/userManagement.controller.js";

const router = Router();
router.get("/", requireAuth, ctrl.list);
router.post("/", requireAuth, ctrl.create);
router.put("/:id", requireAuth, ctrl.update);
router.patch("/:id/verify", requireAuth, ctrl.verify);
router.patch("/:id/activate", requireAuth, ctrl.activate);
router.patch("/:id/deactivate", requireAuth, ctrl.deactivate);
router.delete("/:id", requireAuth, ctrl.remove);

export default router;
