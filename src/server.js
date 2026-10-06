// Must stay the very first import: it puts the whole process on Philippine
// time before any other module creates a Date (see config/timezone.js).
import "./config/timezone.js";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { assertDbConnection } from "./config/db.js";
import { ensureSchema } from "./config/ensureSchema.js";

async function start() {
  try {
    await assertDbConnection();
  } catch (err) {
    console.error("\n✗ Could not connect to MySQL.");
    console.error(`  Tried: ${env.db.user}@${env.db.host}:${env.db.port}/${env.db.name}`);
    console.error(`  Reason: ${err.message}`);
    console.error("\n  Make sure MySQL is running and database/schema.sql has been imported.");
    console.error("  Check backend/.env matches your local MySQL credentials.\n");
    process.exit(1);
  }

  // Bring an already-running database up to date (adds any table/column
  // introduced after your copy of schema.sql) — a no-op when it's current.
  const upgraded = await ensureSchema();
  if (upgraded.length > 0) {
    console.log(`\n✓ Database upgraded automatically: ${upgraded.join(", ")}`);
  }

  app.listen(env.port, () => {
    console.log(`\nOSAA-TRACK Admin Panel API`);
    console.log(`  Listening on:  http://localhost:${env.port}`);
    console.log(`  Environment:   ${env.nodeEnv}`);
    console.log(`  Database:      MySQL @ ${env.db.host}:${env.db.port}/${env.db.name}`);
    console.log(`  Seeded admin:  osaa_ms@psu.edu.ph\n`);
  });
}

start();
