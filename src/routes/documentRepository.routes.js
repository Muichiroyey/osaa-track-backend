import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import * as ctrl from "../controllers/documentRepository.controller.js";

const router = Router();

function handleUpload(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: err.message || "Upload failed." });
    }
    next();
  });
}

router.get("/folders", requireAuth, ctrl.listFolders);
router.post("/folders", requireAuth, ctrl.createFolder);
router.delete("/folders/:id", requireAuth, ctrl.deleteFolder);

router.get("/folders/:folderId/files", requireAuth, ctrl.listFiles);
router.post("/folders/:folderId/files", requireAuth, handleUpload, ctrl.uploadFile);

router.get("/files/:id/view", requireAuth, ctrl.viewFile);
router.get("/files/:id/download", requireAuth, ctrl.downloadFile);
router.patch("/files/:id/archive", requireAuth, ctrl.archiveFile);
router.patch("/files/:id/restore", requireAuth, ctrl.restoreFile);
router.delete("/files/:id", requireAuth, ctrl.deleteFile);

router.get("/transmissions", requireAuth, ctrl.listTransmissions);
router.post("/transmissions", requireAuth, ctrl.createTransmission);
router.patch("/transmissions/:id/status", requireAuth, ctrl.updateTransmissionStatus);

export default router;
