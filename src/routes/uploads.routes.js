import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAnyAuth } from "../middleware/portalAuth.js";
import { upload as uploadMiddleware } from "../middleware/upload.js";
import { canPortalUserAccessFile } from "../repositories/portalRepo.js";
import * as ctrl from "../controllers/uploads.controller.js";

const router = Router();

function handleUpload(req, res, next) {
  uploadMiddleware.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: "VALIDATION_ERROR", message: err.message || "Upload failed." });
    next();
  });
}

/**
 * One upload pipeline for the whole system — the Admin Panel and the
 * Student/Alumni Portal both POST here, so there is a single storage
 * path, a single uploaded_files registry, and a single viewer.
 *
 * Reading a file back is where the two identities differ. The admin may
 * read any file. A portal user may only read files reachable through
 * their own portal, because uploaded_files ids are sequential and
 * "authenticated" on its own would let any student walk the id space and
 * open other people's submitted documents. `requirePortalFileAccess`
 * below is that check; it does nothing when the caller is the admin.
 */
async function requirePortalFileAccess(req, res, next) {
  if (!req.portalUser) return next(); // admin session — unrestricted, as before
  const allowed = await canPortalUserAccessFile(req.portalUser, req.params.id);
  if (!allowed) {
    // Deliberately the same 404 an unknown id gets, so this can't be used
    // to probe which file ids exist.
    return res.status(404).json({ error: "NOT_FOUND", message: "File not found." });
  }
  next();
}

router.post("/", requireAnyAuth, handleUpload, ctrl.upload);
router.get("/:id/view", requireAnyAuth, requirePortalFileAccess, ctrl.view);
router.get("/:id/download", requireAnyAuth, requirePortalFileAccess, ctrl.download);

export default router;
