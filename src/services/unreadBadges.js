import { pool } from "../config/db.js";

/**
 * UNREAD RED COUNTS (the little red circle beside a module)
 * ───────────────────────────────────────────────────────────────────────
 * Every person has, per module, a "last opened" time (module_seen). A
 * module's red number is how many things arrived in it AFTER that time, and
 * opening the module moves the time forward — so the number clears when you
 * look and only comes back for something genuinely new.
 *
 * The first time we see a person we start their clock at "now" for every
 * module, so the content that existed before they ever had a badge doesn't
 * greet them as a pile of "new" items.
 */

export async function getSeenMap(userId, keys) {
  const [rows] = await pool.query("SELECT module_key, seen_at FROM module_seen WHERE user_id = ?", [userId]);
  const map = new Map(rows.map((r) => [r.module_key, r.seen_at]));
  const missing = keys.filter((k) => !map.has(k));
  if (missing.length > 0) {
    await pool.query(
      "INSERT IGNORE INTO module_seen (user_id, module_key, seen_at) VALUES ?",
      [missing.map((k) => [userId, k, new Date()])]
    ).catch(() => {});
    // Re-read so the value we compare against is exactly what MySQL stored.
    const [again] = await pool.query("SELECT module_key, seen_at FROM module_seen WHERE user_id = ?", [userId]);
    return new Map(again.map((r) => [r.module_key, r.seen_at]));
  }
  return map;
}

/**
 * specs: { moduleKey: async (seenAt) => number }
 * Returns { counts: { moduleKey: n }, tracked: [moduleKey, ...] }
 */
export async function computeUnread(userId, specs) {
  const keys = Object.keys(specs);
  const seen = await getSeenMap(userId, keys);
  const entries = await Promise.all(
    keys.map(async (k) => [k, Math.max(0, Number(await specs[k](seen.get(k))) || 0)])
  );
  return { counts: Object.fromEntries(entries), tracked: keys };
}

export async function markModuleSeen(userId, key) {
  await pool.query(
    `INSERT INTO module_seen (user_id, module_key, seen_at) VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE seen_at = NOW()`,
    [userId, key]
  );
}

export async function countSince(sql, params) {
  const [rows] = await pool.query(sql, params);
  return Number(rows[0]?.c || 0);
}
