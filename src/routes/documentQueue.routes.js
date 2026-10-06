import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/documentQueue.controller.js";

const router = Router();

router.get("/", requireAuth, ctrl.list);
router.get("/archive/counts", requireAuth, ctrl.archiveCounts);
router.get("/archive", requireAuth, ctrl.listArchive);
router.delete("/archive", requireAuth, ctrl.bulkDeleteArchive);
router.get("/:id", requireAuth, ctrl.getOne);
router.post("/", requireAuth, ctrl.create);
router.post("/request-from-office", requireAuth, ctrl.requestFromOffice);
router.post("/:id/decide", requireAuth, ctrl.decide);
router.post("/:id/attach-file", requireAuth, ctrl.attachFile);
router.post("/:id/sign", requireAuth, ctrl.sign);
router.post("/:id/confirm-signature", requireAuth, ctrl.confirmSignature);
router.get("/:id/latest-file", requireAuth, ctrl.latestFile);
router.get("/:id/signature-layers", requireAuth, ctrl.signatureLayers);
router.post("/:id/resubmit", requireAuth, ctrl.resubmit);
router.post("/:id/routes", requireAuth, ctrl.route);
router.patch("/routes/:routeId", requireAuth, ctrl.updateRoute);
router.post("/routes/:routeId/sign", requireAuth, ctrl.signRoute);
router.post("/routes/:routeId/confirm", requireAuth, ctrl.confirmRoute);

export default router;
