import { Router } from "express";
import { requirePortalAuth, requireType } from "../middleware/portalAuth.js";
import { upload } from "../middleware/upload.js";
import * as officeAuth from "../controllers/officeAuth.controller.js";
import * as officeDashboard from "../controllers/officeDashboard.controller.js";
import * as portalContent from "../controllers/portalContent.controller.js";
import * as officeContent from "../controllers/officeContent.controller.js";
import * as officeDocs from "../controllers/officeDocumentQueue.controller.js";
import * as officeEndorsement from "../controllers/officeEndorsement.controller.js";
import * as officeRepository from "../controllers/officeDocumentRepository.controller.js";
import * as studentLeaders from "../controllers/studentLeaders.controller.js";
import * as officeLeaders from "../controllers/officeStudentLeaders.controller.js";
import * as portalChat from "../controllers/portalChat.controller.js";
import { openStream } from "../services/realtime.js";

const router = Router();
const office = [requirePortalAuth, requireType("offices")];

function handleUpload(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: "VALIDATION_ERROR", message: err.message || "Upload failed." });
    next();
  });
}

// ── Auth (Office Log-In Panel — no session required for login itself) ───
router.post("/auth/login", officeAuth.login);
router.get("/auth/me", requirePortalAuth, requireType("offices"), officeAuth.me);
router.post("/auth/logout", requirePortalAuth, requireType("offices"), officeAuth.logout);
router.put("/auth/profile", requirePortalAuth, requireType("offices"), officeAuth.updateProfile);
router.put("/auth/password", requirePortalAuth, requireType("offices"), officeAuth.updatePassword);

// ── Live updates — same mechanism as the Student/Alumni Portal; carries
// topic names only, so any signed-in office just re-fetches on its own
// screens (see realtime.js's /api/office/ mapping). ──────────────────────
router.get("/realtime/stream", office, (req, res) => {
  openStream(req, res, { scope: "portal", userId: req.portalUser.id });
});

// ── Office directory (for the endorsement/transmission "pick an office"
// pickers) — every authorized office, regardless of whether it has a
// portal login yet. ────────────────────────────────────────────────────
router.get("/offices", office, async (req, res) => {
  const { listOffices } = await import("../repositories/officeRepo.js");
  res.json({ items: await listOffices() });
});

// ── Dashboard (spec section 1) — a light rollup built from the same
// office-scoped queries every module below already answers to. ──────────
router.get("/summary", office, officeDashboard.summary);
router.post("/seen", office, officeDashboard.markSeen);

// ── Announcements (spec section 2 — VIEW / READ ONLY) — identical to the
// Student/Alumni Portal's read-only feed, just audience-scoped to 'offices'
// (see audienceKeyFor in portalContent.controller.js). ────────────────────
router.get("/announcements", office, portalContent.listAnnouncements);
router.get("/announcements/:id", office, portalContent.getAnnouncement);

// ── Campus Feed (spec section 3 — VIEW / POST / MANAGE OWN POSTS) ───────
router.get("/campus-feed", office, portalContent.listCampusFeed);
router.get("/campus-feed/mine", office, officeContent.listMyPosts);
router.post("/campus-feed", office, officeContent.createPost);
router.put("/campus-feed/:id", office, officeContent.updatePost);
router.patch("/campus-feed/:id/hidden", office, officeContent.setHidden);
router.delete("/campus-feed/:id", office, officeContent.deletePost);

// ── Document Queue (spec section 4) ──────────────────────────────────────
router.get("/document-queue", office, officeDocs.list);
router.post("/document-queue", office, officeDocs.create);
router.get("/document-queue/:id", office, officeDocs.getOne);
router.get("/document-queue/:id/files", office, officeDocs.downloadable);
router.post("/document-queue/:id/resubmit", office, officeDocs.resubmit);
router.post("/document-queue/:id/fulfill", office, officeDocs.fulfillRequested);

// E-signature inbox — requests routed TO this office.
router.get("/document-queue/routes/mine", office, officeDocs.listRoutes);
router.get("/document-queue/routes/:routeId/file", office, officeDocs.latestFileForRoute);
router.get("/document-queue/routes/:routeId/layers", office, officeDocs.signatureLayersForRoute);
router.post("/document-queue/routes/:routeId/sign", office, officeDocs.signRoute);
router.post("/document-queue/routes/:routeId/confirm", office, officeDocs.confirmRoute);

// ── Student Endorsement (spec section 5) ─────────────────────────────────
router.get("/endorsements", office, officeEndorsement.list);
router.get("/endorsements/:id", office, officeEndorsement.getOne);
router.post("/endorsements", office, officeEndorsement.create);
router.post("/endorsements/search", office, officeEndorsement.createSearch);
router.patch("/endorsements/:id/status", office, officeEndorsement.updateStatus);

// ── Document Repository (spec section 6, own repository + inter-office
// transmission) ───────────────────────────────────────────────────────────
router.get("/document-repository/folders", office, officeRepository.listFolders);
router.post("/document-repository/folders", office, officeRepository.createFolder);
router.delete("/document-repository/folders/:id", office, officeRepository.deleteFolder);
router.get("/document-repository/folders/:folderId/files", office, officeRepository.listFiles);
router.post("/document-repository/folders/:folderId/files", office, handleUpload, officeRepository.uploadFile);
router.get("/document-repository/files/:id/view", office, officeRepository.viewFile);
router.get("/document-repository/files/:id/download", office, officeRepository.downloadFile);
router.delete("/document-repository/files/:id", office, officeRepository.deleteFile);

router.get("/document-repository/transmissions", office, officeRepository.listTransmissions);
router.post("/document-repository/transmissions", office, officeRepository.createTransmission);
router.patch("/document-repository/transmissions/:id/status", office, officeRepository.updateTransmissionStatus);
router.post("/document-repository/transmissions/:id/respond", office, officeRepository.respondToTransmission);

// ── Student Leader Directory (spec section 7) ────────────────────────────
router.get("/student-leaders/organizations", office, studentLeaders.listOrganizations);
router.get("/student-leaders/organizations/:id", office, studentLeaders.getOrganization);
router.get("/student-leaders/organizations/:id/officers", office, studentLeaders.listOfficers);
router.get("/student-leaders/organizations/:id/documents", office, officeLeaders.listPublicDocuments);
router.get("/student-leaders/organizations/:id/chart.pdf", office, studentLeaders.downloadOrgChartPdf);

router.get("/student-leaders/mine", office, officeLeaders.getMyOrganization);
router.post("/student-leaders/mine", office, officeLeaders.claimOrCreateOrganization);
router.put("/student-leaders/mine", office, officeLeaders.updateMyOrganization);
router.put("/student-leaders/mine/cbl", office, officeLeaders.updateMyOrganizationCbl);
router.get("/student-leaders/mine/documents", office, officeLeaders.listMyDocuments);
router.post("/student-leaders/mine/documents", office, officeLeaders.addMyDocument);
router.put("/student-leaders/mine/documents/:id", office, officeLeaders.updateMyDocument);
router.patch("/student-leaders/mine/documents/:id/hidden", office, officeLeaders.setMyDocumentHidden);
router.delete("/student-leaders/mine/documents/:id", office, officeLeaders.deleteMyDocument);
router.get("/student-leaders/mine/officers", office, officeLeaders.listMyOfficers);
router.post("/student-leaders/mine/officers", office, officeLeaders.createOfficer);
router.put("/student-leaders/officers/:id", office, officeLeaders.updateOfficer);
router.delete("/student-leaders/officers/:id", office, officeLeaders.deleteOfficer);

// ── FAQs (spec section 8 — READ-ONLY) ────────────────────────────────────
router.get("/faq", office, portalContent.listFaqs);

// ── SAA Chat (spec section 9) — identical mechanics to the Student/Alumni
// Portal (everything keys off req.portalUser.id, already generic). ───────
router.get("/chat/conversation", office, portalChat.getConversation);
router.get("/chat/conversations/:id/messages", office, portalChat.listMessages);
router.post("/chat/conversations/:id/messages", office, portalChat.sendMessage);
router.post("/chat/conversations/:id/messages/:messageId/unsend", office, portalChat.unsendMessage);

export default router;
