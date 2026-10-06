import { Router } from "express";
import { requireStaff } from "../middleware/staffAuth.js";
import { openStream } from "../services/realtime.js";
import { pool } from "../config/db.js";
import * as staffAuth from "../controllers/staffAuth.controller.js";
import * as staffDashboard from "../controllers/staffDashboard.controller.js";
import * as workflow from "../controllers/staffWorkflow.controller.js";
import * as analyticsRepo from "../repositories/analyticsRepo.js";
import * as reportsRepo from "../repositories/reportsRepo.js";

// The SAME admin routers the Admin Panel uses — staff get a "copy of the
// admin" by reaching those modules through /api/staff, not by a second copy
// of every controller. Each of those routers calls the admin's requireAuth,
// which steps aside for a request the staff gate (requireStaff) has already
// authenticated. Modules staff are NOT given (Document Repository and User
// Management) are simply not mounted here, so /api/staff/user-management is
// a 404 for staff — the admin's own /api/user-management still refuses a
// staff token (it needs the admin session).
import announcementsRoutes from "./announcements.routes.js";
import campusFeedRoutes from "./campusFeed.routes.js";
import documentQueueRoutes from "./documentQueue.routes.js";
import scholarshipsRoutes from "./scholarships.routes.js";
import achievementsRoutes from "./achievements.routes.js";
import jobPostingsRoutes from "./jobPostings.routes.js";
import studentEndorsementRoutes from "./studentEndorsement.routes.js";
import studentLeadersRoutes from "./studentLeaders.routes.js";
import alumniProfilesRoutes from "./alumniProfiles.routes.js";
import faqRoutes from "./faq.routes.js";
import reportsRoutes from "./reports.routes.js";
import chatRoutes from "./chat.routes.js";
import officesRoutes from "./offices.routes.js";
import uploadsRoutes from "./uploads.routes.js";

const router = Router();

// ── Auth: login is the only open door ───────────────────────────────────
router.post("/auth/login", staffAuth.login);
router.get("/auth/me", requireStaff, staffAuth.me);
router.post("/auth/logout", requireStaff, staffAuth.logout);

// Everything below needs a signed-in, active staff account.
router.use(requireStaff);

router.get("/realtime/stream", (req, res) => openStream(req, res, { scope: "admin" }));

// ── Home ────────────────────────────────────────────────────────────────
router.get("/dashboard/summary", staffDashboard.getSummary);

// ── Settings (spec 15): profile, photo, password ────────────────────────
router.get("/settings", staffAuth.getSettings);
router.put("/settings/profile", staffAuth.updateProfile);
router.put("/settings/photo", staffAuth.updatePhoto);
router.put("/settings/password", staffAuth.updatePassword);

// ── Document Queue (spec 4) — pre-screening, physical signing, forward to
// Dean; every e-signature action is refused (see staffWorkflow.controller). ─
router.post("/document-queue/:id/forward-to-dean", workflow.forwardToDean);
router.post("/document-queue/request-from-office", (req, res) =>
  res.status(403).json({ error: "DEAN_ONLY", message: "Requesting a document from an office is handled by the SAA Dean." })
);
router.use("/document-queue", workflow.guardDocumentQueue);
router.post("/document-queue/:id/decide", workflow.guardDecide);
router.use("/document-queue", documentQueueRoutes);

// ── Achievement Management (spec 6) — screening only ────────────────────
router.post("/achievements/:id/verify", workflow.verifyAchievement);
router.patch("/achievements/:id/decide", workflow.guardAchievementDecide);
router.use("/achievements", achievementsRoutes);

// ── Analytics (spec 11) — READ ONLY, and without the two modules staff
// don't have (User Management / Document Repository). ───────────────────
router.get("/analytics", async (req, res) => {
  const data = await analyticsRepo.getAnalytics();
  delete data.userManagement;
  delete data.documentRepository;
  res.json(data);
});

// ── Report Generation (spec 13) — the User Directory report belongs to
// User Management, which staff don't have. ──────────────────────────────
const HIDDEN_REPORTS = new Set(["users"]);
router.get("/reports/definitions", async (req, res) => {
  res.json({
    items: reportsRepo.REPORT_DEFINITIONS.filter((d) => !HIDDEN_REPORTS.has(d.key)),
    colleges: await reportsRepo.listColleges(),
    collegePrograms: reportsRepo.COLLEGE_PROGRAMS,
  });
});
router.post("/reports/generate", (req, res, next) => {
  if (HIDDEN_REPORTS.has(req.body?.reportKey)) {
    return res.status(403).json({ error: "DEAN_ONLY", message: "That report is only available to the SAA Administrator." });
  }
  next();
});

// ── Files: staff open submissions in the viewer, but never another
// office's inter-office transmission attachments (Document Repository). ───
router.use("/uploads/:id", async (req, res, next) => {
  if (req.method !== "GET") return next();
  const [rows] = await pool.query("SELECT 1 FROM transmission_files WHERE file_id = ? LIMIT 1", [Number(req.params.id) || 0]);
  if (rows.length) return res.status(404).json({ error: "NOT_FOUND", message: "File not found." });
  next();
});

// ── Everything else is the admin's own module, unchanged ────────────────
router.use("/uploads", uploadsRoutes);
router.use("/announcements", announcementsRoutes);
router.use("/campus-feed", campusFeedRoutes);
router.use("/scholarships", scholarshipsRoutes);
router.use("/job-postings", jobPostingsRoutes);
router.use("/student-endorsement", studentEndorsementRoutes);
router.use("/student-leaders", studentLeadersRoutes);
router.use("/alumni-profiles", alumniProfilesRoutes);
router.use("/faq", faqRoutes);
router.use("/reports", reportsRoutes);
router.use("/chat", chatRoutes);
router.use("/offices", officesRoutes);

export default router;
