import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { getOffices } from "../controllers/offices.controller.js";

const router = Router();
router.get("/", requireAuth, getOffices);

export default router;
