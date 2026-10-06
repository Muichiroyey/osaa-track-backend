import fs from "node:fs";
import path from "node:path";
import { pool } from "../config/db.js";
import * as scholarshipRepo from "./scholarshipRepo.js";
import * as achievementRepo from "./achievementRepo.js";
import * as alumniRepo from "./alumniRepo.js";
import * as userRepo from "./userRepo.js";
import * as announcementRepo from "./announcementRepo.js";
import * as uploadedFileRepo from "./uploadedFileRepo.js";
import * as studentLeadersRepo from "./studentLeadersRepo.js";
import { UPLOAD_DIR } from "../middleware/upload.js";
import { COLLEGE_PROGRAMS as OFFICIAL_COLLEGE_PROGRAMS, COLLEGE_ABBREVIATIONS as OFFICIAL_COLLEGE_ABBREVIATIONS } from "../constants/collegesAndCourses.js";
import { parseDbDate, PH_TIME_ZONE } from "../config/timezone.js";

// ── formatting helpers ───────────────────────────────────────────────
function formatDate(value) {
  if (!value) return null;
  const d = parseDbDate(value);
  if (!d) return String(value);
  return d.toLocaleDateString("en-US", { timeZone: PH_TIME_ZONE, month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return `PHP ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function titleCase(value) {
  if (!value) return value;
  return String(value)
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── college / course lookups ────────────────────────────────────────────
// This is the university's official college/course list (as provided by
// the admin), and Report Generation's College/Course filters are limited
// to exactly this — it is intentionally its own source, separate from
// Achievement Management's COLLEGE_PROGRAMS (that one matches a Figma
// design exactly and is a different, already-approved feature).
export const COLLEGE_PROGRAMS = OFFICIAL_COLLEGE_PROGRAMS;
const COLLEGE_NAMES = Object.keys(COLLEGE_PROGRAMS);
const ALL_PROGRAMS = COLLEGE_NAMES.flatMap((c) => COLLEGE_PROGRAMS[c]);

// Abbreviations already in use elsewhere in the system (offices' own
// `category` values, e.g. in Document Queue/Document Repository routing)
// — reused here so a student/alumni/office record whose department was
// entered as an abbreviation still matches when filtering reports by full
// college name. Each college may accept more than one abbreviation (the
// offices directory already uses "CTHM" while the official list spells
// it "CHTM").
const COLLEGE_ABBREVIATIONS = OFFICIAL_COLLEGE_ABBREVIATIONS;

const COLLEGE_FILTER_OPTIONS = [{ value: "", label: "All colleges" }, ...COLLEGE_NAMES.map((n) => ({ value: n, label: n }))];

// A "college" or "course/program" report filter is matched against
// whatever free-text field the record actually stores (e.g. a user's
// `department`, or a scholarship recipient's `program`) rather than a
// clean foreign key, since that's how those fields exist today. This
// normalizes both sides (case, punctuation, the word "in") before
// comparing, so "BS Information Technology" still matches the canonical
// "BS in Information Technology", and an office's college abbreviation
// (e.g. "CCS") still matches "College of Computing Sciences".
function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\bin\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textMatchesCollege(text, college) {
  const norm = normalizeText(text);
  if (!norm || !college) return false;
  const collegeNorm = normalizeText(college);
  if (norm === collegeNorm || norm.includes(collegeNorm)) return true;
  const abbrs = COLLEGE_ABBREVIATIONS[college];
  if (abbrs && (Array.isArray(abbrs) ? abbrs : [abbrs]).some((a) => norm === normalizeText(a))) return true;
  return (COLLEGE_PROGRAMS[college] || []).some((p) => {
    const progNorm = normalizeText(p);
    return norm === progNorm || norm.includes(progNorm);
  });
}

function textMatchesProgram(text, program) {
  const norm = normalizeText(text);
  if (!norm || !program) return false;
  const progNorm = normalizeText(program);
  return norm === progNorm || norm.includes(progNorm);
}

const DOC_QUEUE_STATUS_LABELS = {
  pending: "Pending",
  approved_for_signing: "Approved (Physical Signing)",
  approved_for_esigning: "Approved (E-Signature)",
  rejected: "Rejected",
  revision_requested: "Needs Revision",
  expired: "Expired",
};

// ── report definitions (also exposed to the frontend, minus the runner) ─
// filters[].type: "select" (optionsSource -> frontend fetches a list to
// build a dropdown) or "text" (free-value input). Everything is optional
// unless required:true.
export const REPORT_DEFINITIONS = [
  {
    key: "scholarship_recipients",
    label: "Scholarship Recipients",
    group: "Scholarships",
    description: "Students granted a scholarship — one program or the full roster, filterable by college or course.",
    landscape: true,
    filters: [
      { key: "scholarshipId", label: "Scholarship", type: "select", optionsSource: "scholarships", placeholder: "All scholarships" },
      { key: "college", label: "College", type: "select", options: COLLEGE_FILTER_OPTIONS },
      { key: "program", label: "Course / Program", type: "select", cascadeFrom: "college", placeholder: "All courses / programs" },
    ],
    columns: [
      { key: "name", label: "Student Name", weight: 1.6 },
      { key: "studentId", label: "Student ID", weight: 1 },
      { key: "scholarship", label: "Scholarship", weight: 1.6 },
      { key: "program", label: "Program", weight: 1.6 },
      { key: "term", label: "Term", weight: 1.1 },
      { key: "amount", label: "Amount", weight: 1 },
      { key: "status", label: "Status", weight: 0.9 },
    ],
  },
  {
    key: "scholarship_applicants",
    label: "Scholarship Applicants",
    group: "Scholarships",
    description: "Applicant pool and decisions for one specific scholarship, filterable by college or course.",
    landscape: false,
    filters: [
      { key: "scholarshipId", label: "Scholarship", type: "select", optionsSource: "scholarships", required: true },
      { key: "college", label: "College", type: "select", options: COLLEGE_FILTER_OPTIONS },
      { key: "program", label: "Course / Program", type: "select", cascadeFrom: "college", placeholder: "All courses / programs" },
    ],
    columns: [
      { key: "name", label: "Student Name", weight: 2 },
      { key: "studentId", label: "Student ID", weight: 1.2 },
      { key: "status", label: "Status", weight: 1 },
      { key: "appliedOn", label: "Applied On", weight: 1.3 },
    ],
  },
  {
    key: "achievements",
    label: "Student Achievements",
    group: "Student Life",
    description: "Submitted student achievements, filterable by status, college, or course.",
    landscape: true,
    filters: [
      { key: "status", label: "Status", type: "select", options: [{ value: "", label: "All statuses" }, { value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }] },
      { key: "college", label: "College", type: "select", options: COLLEGE_FILTER_OPTIONS },
      { key: "program", label: "Course / Program", type: "select", cascadeFrom: "college", placeholder: "All courses / programs" },
    ],
    columns: [
      { key: "name", label: "Student Name", weight: 1.4 },
      { key: "college", label: "College", weight: 1.8 },
      { key: "program", label: "Program", weight: 1.7 },
      { key: "title", label: "Achievement", weight: 1.8 },
      { key: "status", label: "Status", weight: 0.9 },
      { key: "submittedOn", label: "Submitted On", weight: 1.1 },
    ],
  },
  {
    key: "job_postings",
    label: "Job Postings",
    group: "Campus Opportunities",
    description: "Posted job opportunities, active or inactive.",
    landscape: true,
    filters: [{ key: "status", label: "Status", type: "select", options: [{ value: "", label: "All statuses" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] }],
    columns: [
      { key: "title", label: "Title", weight: 1.6 },
      { key: "company", label: "Company", weight: 1.4 },
      { key: "industry", label: "Industry", weight: 1.1 },
      { key: "location", label: "Location", weight: 1.2 },
      { key: "deadline", label: "Deadline", weight: 1 },
      { key: "status", label: "Status", weight: 0.9 },
      { key: "postedOn", label: "Posted On", weight: 1.1 },
    ],
  },
  {
    key: "alumni_profiles",
    label: "Alumni Profiles",
    group: "Campus Opportunities",
    description: "Alumni directory, filterable by program, batch year, or employment status.",
    landscape: false,
    filters: [
      { key: "program", label: "Program", type: "text", placeholder: "e.g. BS in Information Technology" },
      { key: "batchYear", label: "Batch Year", type: "text", placeholder: "e.g. 2022" },
      { key: "employmentStatus", label: "Employment Status", type: "text", placeholder: "e.g. Employed" },
    ],
    columns: [
      { key: "name", label: "Name", weight: 1.6 },
      { key: "program", label: "Program", weight: 1.7 },
      { key: "batchYear", label: "Batch", weight: 0.8 },
      { key: "employmentStatus", label: "Employment Status", weight: 1.3 },
      { key: "employer", label: "Employer", weight: 1.4 },
    ],
  },
  {
    key: "student_endorsements",
    label: "Student Endorsements",
    group: "Student Life",
    description: "Inbound and outbound endorsements between SAA and other offices.",
    landscape: true,
    filters: [
      { key: "direction", label: "Direction", type: "select", options: [{ value: "", label: "Both directions" }, { value: "inbound", label: "Inbound" }, { value: "outbound", label: "Outbound" }] },
      { key: "status", label: "Status", type: "select", options: [{ value: "", label: "All statuses" }, { value: "pending", label: "Pending" }, { value: "acknowledged", label: "Acknowledged" }, { value: "resolved", label: "Resolved" }] },
    ],
    columns: [
      { key: "direction", label: "Direction", weight: 0.9 },
      { key: "name", label: "Student Name", weight: 1.4 },
      { key: "program", label: "Program", weight: 1.3 },
      { key: "office", label: "Office", weight: 1.5 },
      { key: "purpose", label: "Purpose", weight: 1.6 },
      { key: "status", label: "Status", weight: 0.9 },
      { key: "date", label: "Date", weight: 1.1 },
    ],
  },
  {
    key: "document_queue",
    label: "Document Queue Tickets",
    group: "Administration",
    description: "Document requests moving through the approval/e-signature queue.",
    landscape: true,
    filters: [
      {
        key: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "", label: "All statuses" },
          { value: "pending", label: "Pending" },
          { value: "approved_for_signing", label: "Approved (Physical Signing)" },
          { value: "approved_for_esigning", label: "Approved (E-Signature)" },
          { value: "rejected", label: "Rejected" },
          { value: "revision_requested", label: "Needs Revision" },
          { value: "expired", label: "Expired" },
        ],
      },
      { key: "requesterType", label: "Requester Type", type: "select", options: [{ value: "", label: "All" }, { value: "student", label: "Student" }, { value: "alumni", label: "Alumni" }, { value: "offices", label: "Office" }] },
    ],
    columns: [
      { key: "ticketNo", label: "Ticket No.", weight: 0.9 },
      { key: "requester", label: "Requester", weight: 1.5 },
      { key: "type", label: "Type", weight: 0.9 },
      { key: "docType", label: "Document Type", weight: 1.7 },
      { key: "status", label: "Status", weight: 1.4 },
      { key: "submittedOn", label: "Submitted On", weight: 1.1 },
      { key: "decidedOn", label: "Decided On", weight: 1.1 },
    ],
  },
  {
    key: "users",
    label: "User Directory",
    group: "Administration",
    description: "Every account in User Management, by type, status, college, or course.",
    landscape: true,
    filters: [
      { key: "type", label: "Account Type", type: "select", options: [{ value: "", label: "All types" }, { value: "student", label: "Student" }, { value: "alumni", label: "Alumni" }, { value: "staff", label: "Staff" }, { value: "offices", label: "Offices" }] },
      { key: "status", label: "Status", type: "select", options: [{ value: "", label: "All statuses" }, { value: "active", label: "Active" }, { value: "pending", label: "Pending" }, { value: "inactive", label: "Inactive" }] },
      { key: "college", label: "College", type: "select", options: COLLEGE_FILTER_OPTIONS },
      { key: "program", label: "Course / Program", type: "select", cascadeFrom: "college", placeholder: "All courses / programs" },
    ],
    columns: [
      { key: "code", label: "Code", weight: 0.9 },
      { key: "name", label: "Name", weight: 1.5 },
      { key: "email", label: "Email", weight: 1.7 },
      { key: "type", label: "Type", weight: 0.9 },
      { key: "department", label: "Department", weight: 1.3 },
      { key: "status", label: "Status", weight: 0.9 },
      { key: "createdOn", label: "Created On", weight: 1.1 },
    ],
  },
  {
    key: "announcements",
    label: "Announcements",
    group: "Administration",
    description: "Announcements by status, with priority and audience.",
    landscape: false,
    filters: [{ key: "status", label: "Status", type: "select", options: [{ value: "", label: "All statuses" }, { value: "draft", label: "Draft" }, { value: "published", label: "Published" }, { value: "archived", label: "Archived" }] }],
    columns: [
      { key: "title", label: "Title", weight: 2.2 },
      { key: "priority", label: "Priority", weight: 0.9 },
      { key: "audience", label: "Audience", weight: 1.4 },
      { key: "status", label: "Status", weight: 0.9 },
      { key: "date", label: "Published / Created", weight: 1.3 },
    ],
  },
  {
    key: "student_leaders",
    label: "Student Leaders Directory",
    group: "Student Life",
    description: "Officer directory for one campus organization, or all of them.",
    landscape: false,
    filters: [{ key: "organizationId", label: "Organization", type: "select", optionsSource: "organizations", placeholder: "All organizations" }],
    columns: [
      { key: "organization", label: "Organization", weight: 1.6 },
      { key: "name", label: "Officer Name", weight: 1.5 },
      { key: "position", label: "Position", weight: 1.4 },
      { key: "category", label: "Category", weight: 1.1 },
      { key: "reportsTo", label: "Reports To", weight: 1.4 },
    ],
  },
  {
    key: "scholarship_application_individual",
    label: "Individual Scholarship Application",
    group: "Scholarships",
    description: "One applicant's complete application record — pick a student to generate their PDF.",
    layout: "individual",
    filters: [
      {
        key: "applicantId",
        label: "Applicant",
        type: "select",
        optionsSource: "scholarship_applicants",
        required: true,
        searchable: true,
        placeholder: "Search applicants by name...",
      },
    ],
  },
  {
    key: "achievement_individual",
    label: "Individual Achievement Record",
    group: "Student Life",
    description: "One student's complete achievement submission — pick a record to generate their PDF.",
    layout: "individual",
    filters: [
      {
        key: "achievementId",
        label: "Achievement Submission",
        type: "select",
        optionsSource: "achievements_all",
        required: true,
        searchable: true,
        placeholder: "Search achievements by student or title...",
      },
    ],
  },
];

// ── per-report query runners ─────────────────────────────────────────
async function runScholarshipRecipients(filters) {
  const rows = await scholarshipRepo.listRecipients({ scholarshipId: filters.scholarshipId || undefined });
  let filtered = rows;
  if (filters.college) filtered = filtered.filter((r) => textMatchesCollege(r.program, filters.college));
  if (filters.program) filtered = filtered.filter((r) => textMatchesProgram(r.program, filters.program));
  return filtered.map((r) => ({
    name: r.student_name,
    studentId: r.student_id,
    scholarship: r.scholarship_name || r.category_name || "\u2014",
    program: r.program,
    term: r.term,
    amount: formatCurrency(r.amount),
    status: r.status,
  }));
}

async function runScholarshipApplicants(filters) {
  if (!filters.scholarshipId) return [];
  const rows = await scholarshipRepo.listApplicants(filters.scholarshipId);
  let filtered = rows;
  if (filters.college) filtered = filtered.filter((r) => textMatchesCollege(r.program, filters.college));
  if (filters.program) filtered = filtered.filter((r) => textMatchesProgram(r.program, filters.program));
  return filtered.map((r) => ({
    name: r.student_name,
    studentId: r.student_id,
    status: titleCase(r.status),
    appliedOn: formatDate(r.applied_at),
  }));
}

async function runAchievements(filters) {
  const rows = await achievementRepo.listAchievements({
    status: filters.status || undefined,
    college: filters.college || undefined,
    program: filters.program || undefined,
  });
  return rows.map((r) => ({
    name: r.student_name,
    college: r.college,
    program: r.program,
    title: r.title,
    status: titleCase(r.status),
    submittedOn: formatDate(r.submitted_at),
  }));
}

async function runJobPostings(filters) {
  const all = await pool.query(
    `SELECT * FROM job_postings ${filters.status ? "WHERE status = ?" : ""} ORDER BY created_at DESC`,
    filters.status ? [filters.status] : []
  );
  return all[0].map((r) => ({
    title: r.title,
    company: r.company,
    industry: r.industry,
    location: r.location,
    deadline: formatDate(r.deadline),
    status: titleCase(r.status),
    postedOn: formatDate(r.created_at),
  }));
}

async function runAlumniProfiles(filters) {
  const rows = await alumniRepo.listAlumniProfiles({
    program: filters.program || undefined,
    batchYear: filters.batchYear || undefined,
    employmentStatus: filters.employmentStatus || undefined,
  });
  return rows.map((r) => ({
    name: r.name,
    program: r.program,
    batchYear: r.batch_year,
    employmentStatus: r.employment_status,
    employer: r.employer,
  }));
}

async function runStudentEndorsements(filters) {
  const clauses = [];
  const params = [];
  if (filters.direction) {
    clauses.push("e.direction = ?");
    params.push(filters.direction);
  }
  if (filters.status) {
    clauses.push("e.status = ?");
    params.push(filters.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT e.*, o.name AS office_name FROM endorsements e JOIN offices o ON o.id = e.office_id ${where} ORDER BY e.created_at DESC`,
    params
  );
  return rows.map((r) => ({
    direction: titleCase(r.direction),
    name: r.student_name,
    program: r.program,
    office: r.office_name,
    purpose: r.purpose,
    status: titleCase(r.status),
    date: formatDate(r.created_at),
  }));
}

async function runDocumentQueue(filters) {
  const clauses = [];
  const params = [];
  if (filters.status) {
    clauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters.requesterType) {
    clauses.push("requester_type = ?");
    params.push(filters.requesterType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await pool.query(`SELECT * FROM document_queue_tickets ${where} ORDER BY submitted_at DESC`, params);
  return rows.map((r) => ({
    ticketNo: r.ticket_no,
    requester: r.requester_name,
    type: titleCase(r.requester_type),
    docType: r.document_type,
    status: DOC_QUEUE_STATUS_LABELS[r.status] || titleCase(r.status),
    submittedOn: formatDate(r.submitted_at),
    decidedOn: formatDate(r.decided_at),
  }));
}

async function runUsers(filters) {
  const rows = await userRepo.listUsers({ type: filters.type || undefined, status: filters.status || undefined });
  let filtered = rows;
  if (filters.college) filtered = filtered.filter((r) => textMatchesCollege(r.department, filters.college));
  if (filters.program) filtered = filtered.filter((r) => textMatchesProgram(r.department, filters.program));
  return filtered.map((r) => ({
    code: r.code,
    name: r.name,
    email: r.email,
    type: titleCase(r.type),
    department: r.department,
    status: titleCase(r.status),
    createdOn: formatDate(r.created_at),
  }));
}

async function runAnnouncements(filters) {
  const rows = await announcementRepo.listAnnouncements({ status: filters.status || undefined });
  return rows.map((r) => ({
    title: r.title,
    priority: titleCase(r.priority),
    audience: Array.isArray(r.audience) ? r.audience.map(titleCase).join(", ") : "\u2014",
    status: titleCase(r.status),
    date: formatDate(r.published_at || r.created_at),
  }));
}

async function runStudentLeaders(filters) {
  const clauses = [];
  const params = [];
  if (filters.organizationId) {
    clauses.push("off.organization_id = ?");
    params.push(filters.organizationId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const [rows] = await pool.query(
    `SELECT o.name AS organization_name, off.name, off.position, off.category,
            parent.name AS parent_name, parent2.name AS second_parent_name
     FROM org_officers off
     JOIN student_organizations o ON o.id = off.organization_id
     LEFT JOIN org_officers parent ON parent.id = off.parent_officer_id
     LEFT JOIN org_officers parent2 ON parent2.id = off.second_parent_officer_id
     ${where}
     ORDER BY o.name, off.id`,
    params
  );
  return rows.map((r) => ({
    organization: r.organization_name,
    name: r.name,
    position: r.position,
    category: r.category,
    // Up to two positions above — listed together when there are two.
    reportsTo: [r.parent_name, r.second_parent_name].filter(Boolean).join(" & ") || "Top position",
  }));
}

// ── individual ("pick a student") record runners ────────────────────
// Unlike the table runners above, these resolve a single filter (a
// specific applicant or achievement id) into ONE detailed record object
// for reportPdf.js's buildIndividualRecordPdf, not an array of rows.
async function runScholarshipApplicationIndividual(filters) {
  if (!filters.applicantId) return null;
  const a = await scholarshipRepo.getApplicantById(filters.applicantId);
  if (!a) return null;
  const statusTone = a.status === "accepted" ? "success" : a.status === "rejected" ? "danger" : "warning";
  return {
    kicker: "Scholarship Application Record",
    heading: a.student_name,
    subheading: a.student_id ? `Student ID: ${a.student_id}` : null,
    status: { label: titleCase(a.status), tone: statusTone },
    sections: [
      {
        title: "Applicant Information",
        fields: [
          { label: "Student Name", value: a.student_name },
          { label: "Student ID", value: a.student_id },
          { label: "Course / Program", value: a.program },
        ],
      },
      {
        title: "Scholarship Applied For",
        fields: [
          { label: "Scholarship", value: a.scholarship_name },
          { label: "Provider", value: a.scholarship_provider },
          { label: "Award Amount", value: formatCurrency(a.scholarship_amount) },
          { label: "Application Deadline", value: formatDate(a.scholarship_deadline) },
          { label: "Applied On", value: formatDate(a.applied_at) },
          { label: "Current Status", value: titleCase(a.status) },
        ],
      },
    ],
    listSection:
      Array.isArray(a.requirements) && a.requirements.length
        ? { title: "Required Documents (per scholarship posting)", items: a.requirements }
        : null,
    files: a.files || [],
    note: null,
  };
}

async function runAchievementIndividual(filters) {
  if (!filters.achievementId) return null;
  const a = await achievementRepo.getAchievementById(filters.achievementId);
  if (!a) return null;
  const statusTone = a.status === "approved" ? "success" : a.status === "rejected" ? "danger" : "warning";
  return {
    kicker: "Achievement Submission Record",
    heading: a.student_name,
    subheading: [a.college, a.program].filter(Boolean).join(" \u2014 ") || null,
    status: { label: titleCase(a.status), tone: statusTone },
    sections: [
      {
        title: "Student Information",
        fields: [
          { label: "Student Name", value: a.student_name },
          { label: "College", value: a.college },
          { label: "Course / Program", value: a.program },
        ],
      },
      {
        title: "Achievement Details",
        fields: [
          { label: "Title", value: a.title },
          { label: "Description", value: a.description, long: true },
          { label: "Submitted On", value: formatDate(a.submitted_at) },
          { label: "Decided On", value: formatDate(a.decided_at) },
          { label: "Current Status", value: titleCase(a.status) },
        ],
      },
    ],
    listSection: null,
    files: a.files || [],
    note: a.status === "rejected" && a.rejection_reason ? { title: "Rejection Reason", body: a.rejection_reason } : null,
  };
}

const INDIVIDUAL_RUNNERS = {
  scholarship_application_individual: runScholarshipApplicationIndividual,
  achievement_individual: runAchievementIndividual,
};

export async function runIndividualReport(key, filters = {}) {
  const runner = INDIVIDUAL_RUNNERS[key];
  if (!runner) throw new Error(`Unknown individual report key: ${key}`);
  return runner(filters || {});
}

const RUNNERS = {
  scholarship_recipients: runScholarshipRecipients,
  scholarship_applicants: runScholarshipApplicants,
  achievements: runAchievements,
  job_postings: runJobPostings,
  alumni_profiles: runAlumniProfiles,
  student_endorsements: runStudentEndorsements,
  document_queue: runDocumentQueue,
  users: runUsers,
  announcements: runAnnouncements,
  student_leaders: runStudentLeaders,
};

// optionsSource -> loader, used to resolve a filter's raw id (e.g. a
// scholarship id) into its display name for the PDF header / history list.
const LOOKUP_SOURCES = {
  scholarships: async () => (await scholarshipRepo.listScholarships()).map((s) => ({ id: s.id, name: s.name })),
  organizations: async () => (await studentLeadersRepo.listOrganizations()).map((o) => ({ id: o.id, name: o.name })),
  colleges: async () => listColleges(),
  // Every applicant across every scholarship posting, labeled with the
  // scholarship + status so the same student applying more than once is
  // still easy to tell apart in the Report Generation picker.
  scholarship_applicants: async () => {
    const rows = await scholarshipRepo.listAllApplicantsForLookup();
    return rows.map((r) => ({
      id: r.id,
      name: `${r.student_name}${r.student_id ? ` (${r.student_id})` : ""} \u2014 ${r.scholarship_name} \u00b7 ${titleCase(r.status)}`,
    }));
  },
  // Every achievement submission, labeled with title + college + status.
  achievements_all: async () => {
    const rows = await achievementRepo.listAllForLookup();
    return rows.map((r) => ({
      id: r.id,
      name: `${r.student_name} \u2014 ${r.title} \u00b7 ${titleCase(r.status)}`,
    }));
  },
};

// Generic options loader for the Report Generation frontend's dropdown/
// searchable-select filters. Returns [] for an unknown source instead of
// throwing, since a stale/unsupported source should just render no
// options rather than break the whole filter form.
export async function getLookupOptions(source) {
  const loader = LOOKUP_SOURCES[source];
  if (!loader) return [];
  return loader();
}

// Builds a short human-readable line like "Scholarship: PSU Grant · Status: Pending"
// for the PDF header and history list, from whatever filter values were sent.
export async function buildFiltersSummary(definition, filters) {
  const parts = [];
  for (const f of definition.filters || []) {
    const raw = filters[f.key];
    if (raw === undefined || raw === null || raw === "") continue;
    let display = raw;
    if (f.type === "select" && f.optionsSource) {
      const loader = LOOKUP_SOURCES[f.optionsSource];
      const list = loader ? await loader() : [];
      const match = list.find((o) => String(o.id) === String(raw));
      display = match ? match.name : raw;
    } else if (f.type === "select" && f.options) {
      const match = f.options.find((o) => String(o.value) === String(raw));
      display = match ? match.label : raw;
    }
    parts.push(`${f.label}: ${display}`);
  }
  return parts.length ? parts.join(" \u00b7 ") : null;
}

export function getDefinition(key) {
  return REPORT_DEFINITIONS.find((d) => d.key === key) || null;
}

export async function runReport(key, filters = {}) {
  const runner = RUNNERS[key];
  if (!runner) throw new Error(`Unknown report key: ${key}`);
  return runner(filters || {});
}

export async function listColleges() {
  return COLLEGE_NAMES.map((name, i) => ({ id: name, name }));
}

// ── generated report history ─────────────────────────────────────────
export async function createGeneratedReport({ reportKey, title, filtersSummary, rowCount, fileId, refNo }) {
  const [result] = await pool.query(
    `INSERT INTO generated_reports (report_key, title, filters_summary, row_count, file_id, ref_no) VALUES (?, ?, ?, ?, ?, ?)`,
    [reportKey, title, filtersSummary || null, rowCount, fileId, refNo || null]
  );
  return result.insertId;
}

export async function listGeneratedReports() {
  const [rows] = await pool.query(
    `SELECT g.id, g.report_key, g.title, g.filters_summary, g.row_count, g.generated_at, g.file_id, g.ref_no, f.size_bytes
     FROM generated_reports g JOIN uploaded_files f ON f.id = g.file_id
     ORDER BY g.generated_at DESC LIMIT 50`
  );
  return rows;
}

export async function getGeneratedReport(id) {
  const [rows] = await pool.query("SELECT * FROM generated_reports WHERE id = ?", [id]);
  return rows[0] || null;
}

export async function deleteGeneratedReport(id) {
  const report = await getGeneratedReport(id);
  if (!report) return false;
  const file = await uploadedFileRepo.getFile(report.file_id);
  if (file) {
    const filePath = path.join(UPLOAD_DIR, file.stored_name);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // non-fatal — the DB rows are still cleaned up below
      }
    }
  }
  // Deleting the uploaded_files row cascades to generated_reports too
  // (FK ON DELETE CASCADE), so this one query removes both.
  await pool.query("DELETE FROM uploaded_files WHERE id = ?", [report.file_id]);
  return true;
}
