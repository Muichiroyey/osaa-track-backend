import express from "express";
import cors from "cors";
import morgan from "morgan";
import { env } from "./config/env.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import { UPLOAD_DIR } from "./middleware/upload.js";
import { makeAsyncSafe } from "./middleware/asyncRoute.js";
import { notifyOnWrite } from "./services/realtime.js";

import authRoutes from "./routes/auth.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import officesRoutes from "./routes/offices.routes.js";
import uploadsRoutes from "./routes/uploads.routes.js";
import announcementsRoutes from "./routes/announcements.routes.js";
import documentRepositoryRoutes from "./routes/documentRepository.routes.js";
import documentQueueRoutes from "./routes/documentQueue.routes.js";
import scholarshipsRoutes from "./routes/scholarships.routes.js";
import achievementsRoutes from "./routes/achievements.routes.js";
import campusFeedRoutes from "./routes/campusFeed.routes.js";
import studentEndorsementRoutes from "./routes/studentEndorsement.routes.js";
import jobPostingsRoutes from "./routes/jobPostings.routes.js";
import alumniProfilesRoutes from "./routes/alumniProfiles.routes.js";
import userManagementRoutes from "./routes/userManagement.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";
import faqRoutes from "./routes/faq.routes.js";
import studentLeadersRoutes from "./routes/studentLeaders.routes.js";
import reportsRoutes from "./routes/reports.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import portalRoutes from "./routes/portal.routes.js";
import officeRoutes from "./routes/office.routes.js";
import staffRoutes from "./routes/staff.routes.js";
import realtimeRoutes from "./routes/realtime.routes.js";

export const app = express();

// CORS_ORIGIN may list several origins separated by commas (one per front-end
// app when they are hosted separately: admin, student & alumni, office, staff).
const corsOrigins = String(env.corsOrigin || "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: corsOrigins.length > 1 ? corsOrigins : corsOrigins[0] || true, credentials: true }));
app.use(express.json({ limit: "5mb" }));
app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));
app.use("/uploads", express.static(UPLOAD_DIR));

// ── Always show fresh data ──────────────────────────────────────────────
// API answers are live database reads. Without these two lines a browser is
// allowed to reuse a stored copy of a GET (or answer "304 Not Modified" from
// an ETag), which is exactly how a list can look one step behind what you
// just saved. "no-store" tells the browser never to keep an API response.
app.set("etag", false);
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  next();
});

// After ANY successful create/edit/delete, tell every open session which
// module changed so their screens refresh instantly (see services/realtime.js).
app.use("/api", notifyOnWrite);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", database: "mysql" });
});

app.use("/api/auth", makeAsyncSafe(authRoutes));
app.use("/api/realtime", makeAsyncSafe(realtimeRoutes));
app.use("/api/dashboard", makeAsyncSafe(dashboardRoutes));
app.use("/api/offices", makeAsyncSafe(officesRoutes));
app.use("/api/uploads", makeAsyncSafe(uploadsRoutes));
app.use("/api/announcements", makeAsyncSafe(announcementsRoutes));
app.use("/api/document-repository", makeAsyncSafe(documentRepositoryRoutes));
app.use("/api/document-queue", makeAsyncSafe(documentQueueRoutes));
app.use("/api/scholarships", makeAsyncSafe(scholarshipsRoutes));
app.use("/api/achievements", makeAsyncSafe(achievementsRoutes));
app.use("/api/campus-feed", makeAsyncSafe(campusFeedRoutes));
app.use("/api/student-endorsement", makeAsyncSafe(studentEndorsementRoutes));
app.use("/api/job-postings", makeAsyncSafe(jobPostingsRoutes));
app.use("/api/alumni-profiles", makeAsyncSafe(alumniProfilesRoutes));
app.use("/api/user-management", makeAsyncSafe(userManagementRoutes));
app.use("/api/analytics", makeAsyncSafe(analyticsRoutes));
app.use("/api/faq", makeAsyncSafe(faqRoutes));
app.use("/api/student-leaders", makeAsyncSafe(studentLeadersRoutes));
app.use("/api/reports", makeAsyncSafe(reportsRoutes));
app.use("/api/settings", makeAsyncSafe(settingsRoutes));
app.use("/api/chat", makeAsyncSafe(chatRoutes));

// Student & Alumni Portal, and the Office Portal below it — same backend,
// same database, same tables as the Admin Panel above; separate route
// trees only because each authenticates its own portal account type
// (users.type student/alumni/offices) instead of the single admin account.
app.use("/api/portal", makeAsyncSafe(portalRoutes));
app.use("/api/office", makeAsyncSafe(officeRoutes));
// SAA Staff Portal — the admin modules again, behind the staff-only gate and
// with the Dean-only actions removed (see routes/staff.routes.js).
app.use("/api/staff", makeAsyncSafe(staffRoutes));

app.use(notFound);
app.use(errorHandler);
