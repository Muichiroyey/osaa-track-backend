import { pool } from "../config/db.js";

export async function listFaqs() {
  const [rows] = await pool.query(
    "SELECT * FROM faqs ORDER BY category ASC, sort_order ASC, id ASC"
  );
  return rows;
}

export async function createFaq({ question, answer, category, sortOrder }) {
  const [result] = await pool.query(
    "INSERT INTO faqs (question, answer, category, sort_order) VALUES (?, ?, ?, ?)",
    [question, answer, category || "General", sortOrder ?? 0]
  );
  return result.insertId;
}

export async function updateFaq(id, { question, answer, category, sortOrder }) {
  const [result] = await pool.query(
    "UPDATE faqs SET question = ?, answer = ?, category = ?, sort_order = ? WHERE id = ?",
    [question, answer, category || "General", sortOrder ?? 0, id]
  );
  return result.affectedRows > 0;
}

export async function deleteFaq(id) {
  const [result] = await pool.query("DELETE FROM faqs WHERE id = ?", [id]);
  return result.affectedRows > 0;
}
