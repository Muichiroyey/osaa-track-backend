import mysql from "mysql2/promise";
import { env } from "./env.js";
import { PH_UTC_OFFSET } from "./timezone.js";

export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.name,
  user: env.db.user,
  password: env.db.password,
  // Explicit, so the pool can never inherit a latin1 default from the
  // server or a my.cnf — the seeded directory contains em dashes and
  // Filipino names with ñ, and those must round-trip byte-for-byte.
  charset: "utf8mb4",
  waitForConnections: true,
  // How many database connections the API may use at once. With many people
  // signed in at the same time, requests queue for a free connection — 10 was
  // tight, so the default is higher and it can be set with DB_POOL_SIZE.
  connectionLimit: env.db.poolSize,
  dateStrings: true,
  // How the driver converts JavaScript Dates it sends to / reads from MySQL.
  timezone: PH_UTC_OFFSET,
});

// Every connection the pool opens is put on Philippine time before it runs
// a single query. This is what makes NOW(), CURDATE() and every
// "DEFAULT CURRENT_TIMESTAMP" column (created_at, submitted_at, signed_at...)
// Philippine time no matter where MySQL itself is hosted — a cloud MySQL
// defaults to UTC, which used to leave every stamp 8 hours behind. All the
// date columns are TIMESTAMPs, which MySQL stores as an absolute moment and
// converts using the connection's zone, so rows saved before this change
// also read correctly now (nothing needs to be migrated).
pool.pool.on("connection", (connection) => {
  connection.query(`SET time_zone = '${PH_UTC_OFFSET}'`);
});

export async function assertDbConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.query("SELECT 1");
  } finally {
    conn.release();
  }
}
