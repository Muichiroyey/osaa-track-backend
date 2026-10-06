/**
 * PHILIPPINE TIME — the one place the whole backend gets its clock from
 * ───────────────────────────────────────────────────────────────────────
 * OSAA-TRACK serves one campus in the Philippines, so every date and time
 * the system generates or shows is Philippine Standard Time (PST, UTC+8).
 * The Philippines has no daylight saving, so this is always exactly +08:00.
 *
 * Why this file exists: a cloud host such as Railway runs in UTC, and so
 * does a default MySQL server there. Before this, that meant NOW() and every
 * "created_at" were written 8 hours behind, and anything the server
 * formatted without naming a time zone read 8 hours behind too — while the
 * same code looked fine on a Philippine laptop. Naming the zone explicitly,
 * in one place, makes the result identical on every machine.
 *
 * Three layers keep it consistent (this file is the first two):
 *   1. process.env.TZ — Node's own clock functions (getHours(), default
 *      toLocaleString(), parsing "2026-10-02 14:30:00") use Manila time.
 *   2. db.js sets every MySQL connection to +08:00, so NOW(), CURDATE() and
 *      DEFAULT CURRENT_TIMESTAMP columns are Manila time.
 *   3. Everything that formats a time for a human passes timeZone
 *      explicitly via the helpers below, so it can never depend on (1).
 */

export const PH_TIME_ZONE = "Asia/Manila";
export const PH_UTC_OFFSET = "+08:00";

// Must run before the first Date is created anywhere; server.js imports this
// file first for exactly that reason.
process.env.TZ = PH_TIME_ZONE;

const DB_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DB_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Turns whatever the database (or an ISO string) gave us into a real Date.
 * MySQL returns "YYYY-MM-DD HH:mm:ss" strings with no zone (db.js uses
 * dateStrings) and, because every connection is set to +08:00, those
 * strings are Philippine wall-clock time — so that is how they are read.
 */
export function parseDbDate(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  let m = DB_DATETIME.exec(text);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}${PH_UTC_OFFSET}`);
  m = DB_DATE_ONLY.exec(text);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00${PH_UTC_OFFSET}`);
  const d = new Date(text); // already carries its own zone (e.g. ends in Z)
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DD" for the given moment as the calendar date in the Philippines. */
export function phDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Midnight (start of the day) in the Philippines, for the given moment. */
export function phStartOfDay(date = new Date()) {
  return new Date(`${phDateKey(date)}T00:00:00${PH_UTC_OFFSET}`);
}

/** Today's calendar date in the Philippines as "YYYY-MM-DD". */
export function phToday() {
  return phDateKey(new Date());
}

/** Human-readable date + time, always Philippine time. */
export function formatPhDateTime(value, options = {}) {
  const d = parseDbDate(value);
  if (!d) return "";
  return d.toLocaleString("en-US", {
    timeZone: PH_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
  });
}

/** Human-readable date only, always Philippine time. */
export function formatPhDate(value, options = {}) {
  const d = parseDbDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    timeZone: PH_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  });
}
