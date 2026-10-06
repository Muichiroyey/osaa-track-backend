import { pool } from "../config/db.js";

// Only these keys can be read/written through the Settings page — an
// allowlist keeps this from ever becoming an arbitrary key-value store.
export const SETTINGS_SCHEMA = {
  documentQueueRevisionDays: { label: "Document Queue revision window (days)", type: "int", default: 7, min: 1, max: 30 },
};

export async function getAllSettings() {
  const [rows] = await pool.query("SELECT setting_key, setting_value FROM system_settings");
  const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
  const result = {};
  for (const [key, def] of Object.entries(SETTINGS_SCHEMA)) {
    const raw = map.has(key) ? map.get(key) : String(def.default);
    result[key] = def.type === "int" ? parseInt(raw, 10) : raw;
  }
  return result;
}

export async function getSettingInt(key, fallback) {
  const def = SETTINGS_SCHEMA[key];
  const [rows] = await pool.query("SELECT setting_value FROM system_settings WHERE setting_key = ?", [key]);
  const raw = rows[0]?.setting_value;
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  return def ? def.default : fallback;
}

export async function updateSettings(updates) {
  const entries = Object.entries(updates || {}).filter(([key]) => key in SETTINGS_SCHEMA);
  for (const [key, value] of entries) {
    const def = SETTINGS_SCHEMA[key];
    let normalized = value;
    if (def.type === "int") {
      normalized = parseInt(value, 10);
      if (!Number.isFinite(normalized)) continue;
      if (def.min != null) normalized = Math.max(def.min, normalized);
      if (def.max != null) normalized = Math.min(def.max, normalized);
    }
    await pool.query(
      "INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
      [key, String(normalized)]
    );
  }
  return getAllSettings();
}
