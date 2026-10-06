import path from "node:path";
import crypto from "node:crypto";
import fs from "node:fs";
import * as repo from "../repositories/reportsRepo.js";
import * as uploadedFileRepo from "../repositories/uploadedFileRepo.js";
import { UPLOAD_DIR } from "../middleware/upload.js";
import { buildTableReportPdf, buildIndividualRecordPdf, PH_TIME_ZONE } from "../services/reportPdf.js";

export async function listDefinitions(req, res) {
  res.json({ items: repo.REPORT_DEFINITIONS, colleges: await repo.listColleges(), collegePrograms: repo.COLLEGE_PROGRAMS });
}

// Backs every select/searchable-select filter's dropdown options, keyed by
// the filter's `optionsSource` (scholarships, organizations, colleges, or
// one of the "pick a student" sources used by the individual reports).
export async function lookupOptions(req, res) {
  const items = await repo.getLookupOptions(req.params.source);
  res.json({ items });
}

// A short, human-referenceable code stamped on every generated PDF's
// masthead (e.g. "RPT-SCH-9F2K7Q") so a printed/downloaded copy can be
// looked up or cited without repeating its full title.
function generateRefNo(reportKey) {
  const prefix = String(reportKey || "rpt").replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase() || "RPT";
  const code = crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 6);
  return `RPT-${prefix}-${code}`;
}

export async function generate(req, res) {
  const { reportKey, filters = {} } = req.body || {};
  const definition = repo.getDefinition(reportKey);
  if (!definition) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "Unknown report type." });
  }

  for (const f of definition.filters || []) {
    if (f.required && !filters[f.key]) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: `${f.label} is required for this report.` });
    }
  }

  const generatedAt = new Date();
  const generatedBy = req.admin?.username || "OSAA-TRACK Admin";
  const refNo = generateRefNo(reportKey);
  const storedName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.pdf`;
  const outPath = path.join(UPLOAD_DIR, storedName);

  let rowCount;
  let title;
  let filtersSummary = null;

  if (definition.layout === "individual") {
    // Single-record "pick a student" reports (Individual Scholarship
    // Application / Individual Achievement Record) — one detailed record
    // rendered as a profile sheet, rather than a table of many rows.
    const record = await repo.runIndividualReport(reportKey, filters);
    if (!record) {
      return res.status(404).json({ error: "NOT_FOUND", message: "No matching record was found for that selection." });
    }
    rowCount = 1;
    title = `${definition.label} \u2014 ${record.heading}`;
    await buildIndividualRecordPdf(
      { reportTitle: definition.label, description: definition.description, refNo, generatedBy, ...record, generatedAt },
      outPath
    );
  } else {
    const rows = await repo.runReport(reportKey, filters);
    filtersSummary = await repo.buildFiltersSummary(definition, filters);
    rowCount = rows.length;
    title = filtersSummary ? `${definition.label} \u2014 ${filtersSummary}` : definition.label;
    await buildTableReportPdf(
      {
        reportTitle: definition.label,
        description: definition.description,
        refNo,
        generatedBy,
        filtersSummary,
        columns: definition.columns,
        rows,
        generatedAt,
        landscape: !!definition.landscape,
      },
      outPath
    );
  }

  const sizeBytes = fs.statSync(outPath).size;
  // File-name date stamp in Philippine time too — toISOString() is always
  // UTC, so a report generated between midnight and 8 AM in the Philippines
  // would otherwise be stamped with the previous day's date. (en-CA gives
  // the YYYY-MM-DD shape.)
  const dateStamp = generatedAt.toLocaleDateString("en-CA", { timeZone: PH_TIME_ZONE });
  const originalName = `${definition.label} - ${dateStamp}.pdf`;
  const fileId = await uploadedFileRepo.createFile({
    originalName,
    storedName,
    mimeType: "application/pdf",
    sizeBytes,
  });

  const id = await repo.createGeneratedReport({
    reportKey,
    title,
    filtersSummary,
    rowCount,
    fileId,
    refNo,
  });

  res.status(201).json({
    id,
    fileId,
    title,
    rowCount,
    refNo,
    generatedAt,
  });
}

export async function listHistory(req, res) {
  res.json({ items: await repo.listGeneratedReports() });
}

export async function deleteHistory(req, res) {
  const ok = await repo.deleteGeneratedReport(req.params.id);
  if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "Report not found." });
  res.json({ message: "Report deleted." });
}
