import { Router } from "express";
import { requirePortalAuth, requireType } from "../middleware/portalAuth.js";
import * as auth from "../controllers/portalAuth.controller.js";
import * as dashboard from "../controllers/portalDashboard.controller.js";
import * as documents from "../controllers/portalDocuments.controller.js";
import * as content from "../controllers/portalContent.controller.js";
import * as services from "../controllers/portalServices.controller.js";
import * as chat from "../controllers/portalChat.controller.js";
import { openStream } from "../services/realtime.js";

const router = Router();

// Student and alumni share one sign-in. `users.type` on the account
// decides which of the routes below it may reach — see requireType.
const student = [requirePortalAuth, requireType("student")];
const alumni = [requirePortalAuth, requireType("alumni")];
// Offices now hold portal-style sessions too (Office Portal), so "both" must
// name its two types explicitly — a valid session alone is no longer enough.
const both = [requirePortalAuth, requireType("student", "alumni")];

// ── Auth (no session required for login itself) ─────────────────────────
router.post("/auth/login", auth.login);
router.get("/auth/me", ...both, auth.me);
router.post("/auth/logout", ...both, auth.logout);
router.put("/auth/profile", ...both, auth.updateProfile);
router.put("/auth/password", ...both, auth.updatePassword);

// ── Live updates — the portal's version of the admin's change stream.
// Signed-in accounts only; carries topic names, never data. ──────────────
router.get("/realtime/stream", both, (req, res) => {
  openStream(req, res, { scope: "portal", userId: req.portalUser.id });
});

// ── Home ────────────────────────────────────────────────────────────────
router.get("/summary", both, dashboard.getSummary);
router.post("/seen", both, dashboard.markSeen);

// ── Document Queue — both types submit and track their own requests ─────
router.get("/document-queue", both, documents.list);
router.post("/document-queue", both, documents.create);
router.get("/document-queue/:id", both, documents.getOne);
router.get("/document-queue/:id/files", both, documents.downloadable);
router.post("/document-queue/:id/resubmit", both, documents.resubmit);

// ── Announcements & FAQ — both types, audience-filtered ─────────────────
router.get("/announcements", both, content.listAnnouncements);
router.get("/announcements/:id", both, content.getAnnouncement);
router.get("/faq", both, content.listFaqs);

// ── SAA Chat — both types, one thread each ──────────────────────────────
router.get("/chat/conversation", both, chat.getConversation);
router.get("/chat/conversations/:id/messages", both, chat.listMessages);
router.post("/chat/conversations/:id/messages", both, chat.sendMessage);
router.post("/chat/conversations/:id/messages/:messageId/unsend", both, chat.unsendMessage);

// ── Student-only ────────────────────────────────────────────────────────
router.get("/campus-feed", student, content.listCampusFeed);
router.get("/scholarships", student, services.listScholarships);
router.get("/scholarships/my-applications", student, services.listMyApplications);
router.post("/scholarships/:id/apply", student, services.apply);
router.get("/achievements", student, services.listAchievements);
router.post("/achievements", student, services.createAchievement);
router.get("/achievements/:id", student, services.getAchievement);
router.get("/student-leaders/organizations", student, content.listOrganizations);
router.get("/student-leaders/organizations/:id", student, content.getOrganization);

// ── Alumni-only ─────────────────────────────────────────────────────────
router.get("/jobs", alumni, content.listJobs);
router.get("/jobs/:id", alumni, content.getJob);
router.get("/profile", alumni, services.getMyProfile);
router.put("/profile", alumni, services.updateMyProfile);

export default router;
