import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/scholarships.controller.js";

const router = Router();

router.get("/", requireAuth, ctrl.list);
router.get("/categories", requireAuth, ctrl.listCategories);
router.post("/categories", requireAuth, ctrl.createCategory);
router.get("/recipients", requireAuth, ctrl.listRecipients);
router.post("/recipients", requireAuth, ctrl.addRecipient);

router.get("/:id", requireAuth, ctrl.getOne);
router.post("/", requireAuth, ctrl.create);
router.put("/:id", requireAuth, ctrl.update);
router.patch("/:id/close", requireAuth, ctrl.close);
router.patch("/:id/reopen", requireAuth, ctrl.reopen);
router.delete("/:id", requireAuth, ctrl.remove);

router.get("/:id/applicants", requireAuth, ctrl.listApplicants);
router.post("/:id/applicants", requireAuth, ctrl.createApplicant);
router.post("/applicants/:applicantId/files", requireAuth, ctrl.addApplicantFile);
router.patch("/applicants/:applicantId", requireAuth, ctrl.decideApplicant);

export default router;
