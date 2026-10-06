import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { openStream } from "../services/realtime.js";

const router = Router();

// Admin Panel's live-update stream. Authenticated exactly like every other
// admin route (Bearer token) — the client reads it with fetch(), not
// EventSource, precisely so the token can travel in the header.
router.get("/stream", requireAuth, (req, res) => {
  openStream(req, res, { scope: "admin" });
});

export default router;
