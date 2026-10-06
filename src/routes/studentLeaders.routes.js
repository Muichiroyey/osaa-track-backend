import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import * as ctrl from "../controllers/studentLeaders.controller.js";

const router = Router();

// Organizations
router.get("/organizations", requireAuth, ctrl.listOrganizations);
router.get("/organizations/:id", requireAuth, ctrl.getOrganization);
router.post("/organizations", requireAuth, ctrl.createOrganization);
router.put("/organizations/:id", requireAuth, ctrl.updateOrganization);
router.delete("/organizations/:id", requireAuth, ctrl.deleteOrganization);
router.put("/organizations/:id/cbl", requireAuth, ctrl.updateOrganizationCbl);

// Organization documents (CBL, Resolutions, Orders, etc.)
router.get("/organizations/:id/documents", requireAuth, ctrl.listOrganizationDocuments);
router.post("/organizations/:id/documents", requireAuth, ctrl.addOrganizationDocument);
router.delete("/organizations/:id/documents/:docId", requireAuth, ctrl.deleteOrganizationDocument);

// Organizational Chart PDF export
router.get("/organizations/:id/chart-pdf", requireAuth, ctrl.downloadOrgChartPdf);

// Officers — nested under an organization for listing/creating, flat for
// editing/deleting a single one.
router.get("/organizations/:orgId/officers", requireAuth, ctrl.listOfficers);
router.post("/organizations/:orgId/officers", requireAuth, ctrl.createOfficer);
router.put("/officers/:id", requireAuth, ctrl.updateOfficer);
router.delete("/officers/:id", requireAuth, ctrl.deleteOfficer);

export default router;
