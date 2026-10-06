// ═══════════════════════════════════════════════════════════════════════
// Official college / course list — Pangasinan State University, Lingayen
// Campus. Provided directly by the admin (College_and_courses.docx) as
// the authoritative list Report Generation's College/Course filters must
// be limited to. This is intentionally kept separate from Achievement
// Management's own COLLEGE_PROGRAMS (that one matches a Figma design
// exactly and is a different, already-approved feature — it is not
// touched by this list).
// ═══════════════════════════════════════════════════════════════════════

export const COLLEGE_PROGRAMS = {
  "College of Arts, Sciences and Letters": [
    "Bachelor of Arts in English Language",
    "Bachelor of Arts in Economics",
    "Bachelor of Science in Biology",
    "Bachelor of Science in Nutrition and Dietetics",
    "Bachelor of Science in Social Work",
    "Natural Science",
    "Physical Education",
  ],
  "College of Business and Public Administration": [
    "Bachelor of Public Administration",
    "Bachelor of Science in Business Administration",
  ],
  "College of Computing Sciences": [
    "Bachelor of Science in Computer Science",
    "Bachelor of Science in Information Technology",
    "Bachelor of Science in Mathematics",
  ],
  "College of Hospitality and Tourism Management": [
    "Bachelor of Science in Hospitality Management",
    "Bachelor of Science in Tourism Management",
  ],
  "College of Teacher Education": [
    "Bachelor of Secondary Education Major in Science",
    "Bachelor of Secondary Education Major in Filipino",
    "Bachelor of Secondary Education Major in English",
    "Bachelor of Secondary Education Major in Social Studies",
    "Bachelor of Technical-Vocational and Teacher Education",
    "Bachelor of Technology and Livelihood Education",
  ],
  "College of Industrial Technology": ["Bachelor of Industrial Technology"],
};

// Short codes already in use elsewhere in the system (the offices
// directory's own `category` values, e.g. in User Management/Document
// Queue routing) — kept as arrays since the offices directory already
// uses "CTHM" for the hospitality/tourism college while the official
// list spells it "CHTM"; both are accepted when matching free-text
// college/department values against this list.
export const COLLEGE_ABBREVIATIONS = {
  "College of Arts, Sciences and Letters": ["CASL"],
  "College of Business and Public Administration": ["CBPA"],
  "College of Computing Sciences": ["CCS"],
  "College of Hospitality and Tourism Management": ["CHTM", "CTHM"],
  "College of Teacher Education": ["CTE"],
  "College of Industrial Technology": ["CIT"],
};

export const COLLEGE_NAMES = Object.keys(COLLEGE_PROGRAMS);
export const ALL_PROGRAMS = COLLEGE_NAMES.flatMap((c) => COLLEGE_PROGRAMS[c]);
