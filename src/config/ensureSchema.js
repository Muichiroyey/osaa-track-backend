import { pool } from "./db.js";

/**
 * SELF-UPGRADING DATABASE
 * ───────────────────────────────────────────────────────────────────────
 * database/schema.sql is the ONE database file and is what a fresh install
 * imports. But a database that is already running (your local one, and the
 * one on Railway) can't just re-import it — that would fail on the first
 * insert or wipe data. So instead of asking anyone to run a migration by
 * hand, the backend checks, every time it starts, whether the few
 * structures added after the original schema exist, and adds whichever are
 * missing. Everything here is idempotent: on an up-to-date database it
 * checks, finds nothing to do, and returns.
 *
 * Each step mirrors what schema.sql already contains for fresh installs —
 * keep the two in sync when adding to either.
 */

async function tableExists(table) {
  const [rows] = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [table]
  );
  return rows.length > 0;
}

async function columnExists(table, column) {
  const [rows] = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1",
    [table, column]
  );
  return rows.length > 0;
}


async function columnIsNullable(table, column) {
  const [rows] = await pool.query(
    "SELECT is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1",
    [table, column]
  );
  return rows[0]?.is_nullable === "YES";
}

async function foreignKeyExists(table, constraint) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ? AND constraint_type = 'FOREIGN KEY' LIMIT 1`,
    [table, constraint]
  );
  return rows.length > 0;
}

async function enumHasValue(table, column, value) {
  const [rows] = await pool.query(
    "SELECT COLUMN_TYPE AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1",
    [table, column]
  );
  return Boolean(rows[0] && String(rows[0].t).includes(`'${value}'`));
}

async function indexExists(table, indexName) {
  const [rows] = await pool.query(
    "SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1",
    [table, indexName]
  );
  return rows.length > 0;
}

const STEPS = [
  {
    // Document Queue e-signatures: one row per signer (the admin, or one
    // routed office) recording WHAT they signed with and WHERE — so the
    // final document can always carry every signer's signature, and any
    // one signer can re-sign without wiping the others.
    name: "esignature_layers table",
    async needed() {
      return !(await tableExists("esignature_layers"));
    },
    async apply() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS esignature_layers (
          id INT PRIMARY KEY AUTO_INCREMENT,
          ticket_id INT NOT NULL,
          signer_key VARCHAR(40) NOT NULL,
          route_id INT NULL,
          signature_file_id INT NULL,
          placements TEXT NOT NULL,
          width_pt DECIMAL(6,2) NOT NULL DEFAULT 110,
          signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uniq_layer_signer (ticket_id, signer_key),
          FOREIGN KEY (ticket_id) REFERENCES document_queue_tickets(id) ON DELETE CASCADE,
          FOREIGN KEY (route_id) REFERENCES esignature_routes(id) ON DELETE CASCADE,
          FOREIGN KEY (signature_file_id) REFERENCES uploaded_files(id) ON DELETE SET NULL
        ) ENGINE=InnoDB
      `);
    },
  },
  {
    // Student Leaders: an officer can now have TWO positions above them.
    name: "org_officers.second_parent_officer_id column",
    async needed() {
      return !(await columnExists("org_officers", "second_parent_officer_id"));
    },
    async apply() {
      await pool.query("ALTER TABLE org_officers ADD COLUMN second_parent_officer_id INT NULL AFTER parent_officer_id");
    },
  },
  {
    name: "org_officers second-parent foreign key",
    async needed() {
      return !(await foreignKeyExists("org_officers", "fk_org_officers_second_parent"));
    },
    async apply() {
      await pool.query(
        `ALTER TABLE org_officers
         ADD CONSTRAINT fk_org_officers_second_parent
         FOREIGN KEY (second_parent_officer_id) REFERENCES org_officers(id) ON DELETE SET NULL`
      );
    },
  },

  // ── Office Portal ──────────────────────────────────────────────────────
  // Everything below mirrors what schema.sql now contains for fresh
  // installs, so an already-running database (local or Railway) picks the
  // Office Portal up on its next boot with no manual migration.
  {
    name: "document_queue_tickets.requester_type accepts 'offices'",
    async needed() {
      return !(await enumHasValue("document_queue_tickets", "requester_type", "offices"));
    },
    async apply() {
      await pool.query("ALTER TABLE document_queue_tickets MODIFY requester_type ENUM('student','alumni','offices') NOT NULL");
    },
  },
  {
    name: "document_queue_tickets.status accepts 'awaiting_submission'",
    async needed() {
      return !(await enumHasValue("document_queue_tickets", "status", "awaiting_submission"));
    },
    async apply() {
      await pool.query(
        "ALTER TABLE document_queue_tickets MODIFY status ENUM('pending','awaiting_submission','approved_for_signing','approved_for_esigning','rejected','revision_requested','expired') NOT NULL DEFAULT 'pending'"
      );
    },
  },
  {
    name: "campus_feed_posts author columns",
    async needed() {
      return !(await columnExists("campus_feed_posts", "author_type"));
    },
    async apply() {
      await pool.query("ALTER TABLE campus_feed_posts ADD COLUMN author_type ENUM('admin','office') NOT NULL DEFAULT 'admin'");
      await pool.query("ALTER TABLE campus_feed_posts ADD COLUMN author_office_id INT NULL");
      await pool.query("ALTER TABLE campus_feed_posts ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT 0");
    },
  },
  {
    name: "campus_feed_posts office foreign key",
    async needed() {
      return !(await foreignKeyExists("campus_feed_posts", "fk_campus_feed_office"));
    },
    async apply() {
      await pool.query(
        "ALTER TABLE campus_feed_posts ADD CONSTRAINT fk_campus_feed_office FOREIGN KEY (author_office_id) REFERENCES offices(id) ON DELETE SET NULL"
      );
    },
  },
  {
    name: "endorsements.source_office_id column",
    async needed() {
      return !(await columnExists("endorsements", "source_office_id"));
    },
    async apply() {
      await pool.query("ALTER TABLE endorsements ADD COLUMN source_office_id INT NULL AFTER office_id");
    },
  },
  {
    name: "endorsements source-office foreign key",
    async needed() {
      return !(await foreignKeyExists("endorsements", "fk_endorsements_source_office"));
    },
    async apply() {
      await pool.query(
        "ALTER TABLE endorsements ADD CONSTRAINT fk_endorsements_source_office FOREIGN KEY (source_office_id) REFERENCES offices(id) ON DELETE SET NULL"
      );
    },
  },
  {
    name: "document_folders.office_id column",
    async needed() {
      return !(await columnExists("document_folders", "office_id"));
    },
    async apply() {
      await pool.query("ALTER TABLE document_folders ADD COLUMN office_id INT NULL AFTER name");
    },
  },
  {
    name: "document_folders office foreign key",
    async needed() {
      return !(await foreignKeyExists("document_folders", "fk_document_folders_office"));
    },
    async apply() {
      await pool.query(
        "ALTER TABLE document_folders ADD CONSTRAINT fk_document_folders_office FOREIGN KEY (office_id) REFERENCES offices(id) ON DELETE CASCADE"
      );
    },
  },
  {
    name: "document_transmissions.from_office_id column",
    async needed() {
      return !(await columnExists("document_transmissions", "from_office_id"));
    },
    async apply() {
      await pool.query("ALTER TABLE document_transmissions ADD COLUMN from_office_id INT NULL AFTER office_id");
    },
  },
  {
    name: "document_transmissions from-office foreign key",
    async needed() {
      return !(await foreignKeyExists("document_transmissions", "fk_transmissions_from_office"));
    },
    async apply() {
      await pool.query(
        "ALTER TABLE document_transmissions ADD CONSTRAINT fk_transmissions_from_office FOREIGN KEY (from_office_id) REFERENCES offices(id) ON DELETE SET NULL"
      );
    },
  },
  {
    name: "student_organizations.office_id column",
    async needed() {
      return !(await columnExists("student_organizations", "office_id"));
    },
    async apply() {
      await pool.query("ALTER TABLE student_organizations ADD COLUMN office_id INT NULL");
    },
  },
  {
    name: "student_organizations one-organization-per-office unique key",
    async needed() {
      return !(await indexExists("student_organizations", "uniq_student_org_office"));
    },
    async apply() {
      await pool.query("ALTER TABLE student_organizations ADD UNIQUE KEY uniq_student_org_office (office_id)");
    },
  },
  {
    name: "student_organizations office foreign key",
    async needed() {
      return !(await foreignKeyExists("student_organizations", "fk_student_org_office"));
    },
    async apply() {
      await pool.query(
        "ALTER TABLE student_organizations ADD CONSTRAINT fk_student_org_office FOREIGN KEY (office_id) REFERENCES offices(id) ON DELETE SET NULL"
      );
    },
  },
  {
    name: "notifications table",
    async needed() {
      return !(await tableExists("notifications"));
    },
    async apply() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INT PRIMARY KEY AUTO_INCREMENT,
          user_id INT NOT NULL,
          type VARCHAR(60) NOT NULL,
          title VARCHAR(255) NOT NULL,
          body VARCHAR(500),
          link_type VARCHAR(60) NULL,
          link_id INT NULL,
          is_read BOOLEAN NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);
    },
  },

  // ── Logos on Campus Feed posts + photo previews ─────────────────────────
  {
    // The admin's own logo (Settings page), shown on admin Campus Feed posts.
    name: "admins.avatar_file_id column",
    async needed() {
      return !(await columnExists("admins", "avatar_file_id"));
    },
    async apply() {
      await pool.query("ALTER TABLE admins ADD COLUMN avatar_file_id INT NULL");
    },
  },
  {
    name: "admins avatar foreign key",
    async needed() {
      return !(await foreignKeyExists("admins", "fk_admins_avatar"));
    },
    async apply() {
      await pool.query(
        "ALTER TABLE admins ADD CONSTRAINT fk_admins_avatar FOREIGN KEY (avatar_file_id) REFERENCES uploaded_files(id) ON DELETE SET NULL"
      );
    },
  },
  {
    // Who uploaded a file, so a portal user can preview what they just
    // attached (before it belongs to any post/message) and nothing else.
    name: "uploaded_files.uploaded_by_user_id column",
    async needed() {
      return !(await columnExists("uploaded_files", "uploaded_by_user_id"));
    },
    async apply() {
      await pool.query("ALTER TABLE uploaded_files ADD COLUMN uploaded_by_user_id INT NULL");
    },
  },

  // ── SAA Staff Portal ────────────────────────────────────────────────────
  // Staff pre-screen Document Queue tickets and Achievement submissions, and
  // hand the complicated / verified ones up to the SAA Dean (the admin
  // panel's "Dean Review" views). Nothing here changes a status: a forwarded
  // ticket is still 'pending' and a verified achievement is still 'pending'
  // to students — these columns only record WHO passed it up and WHEN.
  {
    name: "document_queue_tickets.forwarded_to_dean_at column",
    async needed() {
      return !(await columnExists("document_queue_tickets", "forwarded_to_dean_at"));
    },
    async apply() {
      await pool.query("ALTER TABLE document_queue_tickets ADD COLUMN forwarded_to_dean_at TIMESTAMP NULL");
      await pool.query("ALTER TABLE document_queue_tickets ADD COLUMN forwarded_by_user_id INT NULL");
      await pool.query("ALTER TABLE document_queue_tickets ADD COLUMN forward_note TEXT NULL");
    },
  },
  {
    name: "document_queue_tickets forwarded-by foreign key",
    async needed() {
      return !(await foreignKeyExists("document_queue_tickets", "fk_ticket_forwarded_by"));
    },
    async apply() {
      await pool.query(
        "ALTER TABLE document_queue_tickets ADD CONSTRAINT fk_ticket_forwarded_by FOREIGN KEY (forwarded_by_user_id) REFERENCES users(id) ON DELETE SET NULL"
      );
    },
  },
  {
    name: "achievements.staff_verified_at column",
    async needed() {
      return !(await columnExists("achievements", "staff_verified_at"));
    },
    async apply() {
      await pool.query("ALTER TABLE achievements ADD COLUMN staff_verified_at TIMESTAMP NULL");
      await pool.query("ALTER TABLE achievements ADD COLUMN staff_verified_by_user_id INT NULL");
      await pool.query("ALTER TABLE achievements ADD COLUMN staff_note TEXT NULL");
    },
  },
  {
    name: "achievements staff-verified-by foreign key",
    async needed() {
      return !(await foreignKeyExists("achievements", "fk_achievement_staff_verifier"));
    },
    async apply() {
      await pool.query(
        "ALTER TABLE achievements ADD CONSTRAINT fk_achievement_staff_verifier FOREIGN KEY (staff_verified_by_user_id) REFERENCES users(id) ON DELETE SET NULL"
      );
    },
  },
  {
    // The seeded practice staff account used to have no password because no
    // staff portal existed. Give it the same demo password as the other demo
    // accounts — only if it is still passwordless, so a password the admin
    // set is never touched.
    name: "demo staff account password",
    async needed() {
      const [rows] = await pool.query(
        "SELECT 1 FROM users WHERE email = 'demo.staff@psu.edu.ph' AND is_demo = 1 AND type = 'staff' AND password_hash IS NULL LIMIT 1"
      );
      return rows.length > 0;
    },
    async apply() {
      await pool.query(
        "UPDATE users SET password_hash = '$2a$10$gj3qeGP5WFRVUahDiELPsemLmRtvFyDW5MjFO54NRVXPw4lgrNE5G' WHERE email = 'demo.staff@psu.edu.ph' AND is_demo = 1 AND type = 'staff' AND password_hash IS NULL"
      );
    },
  },
  {
    // Which staff member sent a SAA Chat message (NULL = sent by the admin).
    name: "chat_messages.sender_user_id column",
    async needed() {
      return !(await columnExists("chat_messages", "sender_user_id"));
    },
    async apply() {
      await pool.query("ALTER TABLE chat_messages ADD COLUMN sender_user_id INT NULL");
    },
  },
  {
    name: "chat_messages sender foreign key",
    async needed() {
      return !(await foreignKeyExists("chat_messages", "fk_chat_messages_sender"));
    },
    async apply() {
      await pool.query(
        "ALTER TABLE chat_messages ADD CONSTRAINT fk_chat_messages_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL"
      );
    },
  },
  {
    // Unread badges: when each person last opened each module.
    name: "module_seen table",
    async needed() {
      return !(await tableExists("module_seen"));
    },
    async apply() {
      await pool.query(`CREATE TABLE IF NOT EXISTS module_seen (
        user_id INT NOT NULL,
        module_key VARCHAR(60) NOT NULL,
        seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, module_key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`);
    },
  },
  {
    name: "scholarship_attachments table",
    async needed() {
      return !(await tableExists("scholarship_attachments"));
    },
    async apply() {
      await pool.query(`CREATE TABLE IF NOT EXISTS scholarship_attachments (
        id INT PRIMARY KEY AUTO_INCREMENT,
        scholarship_id INT NOT NULL,
        file_id INT NOT NULL,
        FOREIGN KEY (scholarship_id) REFERENCES scholarships(id) ON DELETE CASCADE,
        FOREIGN KEY (file_id) REFERENCES uploaded_files(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`);
    },
  },
  {
    name: "scholarship_applicants.decided_at column",
    async needed() {
      return !(await columnExists("scholarship_applicants", "decided_at"));
    },
    async apply() {
      await pool.query("ALTER TABLE scholarship_applicants ADD COLUMN decided_at TIMESTAMP NULL");
    },
  },
  {
    name: "achievements.student_number column",
    async needed() {
      return !(await columnExists("achievements", "student_number"));
    },
    async apply() {
      await pool.query("ALTER TABLE achievements ADD COLUMN student_number VARCHAR(50) NULL");
    },
  },
  {
    name: "achievements.college_entered column",
    async needed() {
      return !(await columnExists("achievements", "college_entered"));
    },
    async apply() {
      await pool.query("ALTER TABLE achievements ADD COLUMN college_entered VARCHAR(191) NULL");
    },
  },
  {
    name: "document_transmissions.responded_at column",
    async needed() {
      return !(await columnExists("document_transmissions", "responded_at"));
    },
    async apply() {
      await pool.query("ALTER TABLE document_transmissions ADD COLUMN responded_at TIMESTAMP NULL");
    },
  },
  {
    name: "transmission_files.kind column",
    async needed() {
      return !(await columnExists("transmission_files", "kind"));
    },
    async apply() {
      await pool.query("ALTER TABLE transmission_files ADD COLUMN kind ENUM('original','response') NOT NULL DEFAULT 'original'");
    },
  },
  {
    name: "endorsements.kind column",
    async needed() {
      return !(await columnExists("endorsements", "kind"));
    },
    async apply() {
      await pool.query("ALTER TABLE endorsements ADD COLUMN kind ENUM('referral','search') NOT NULL DEFAULT 'referral'");
    },
  },
  {
    name: "endorsements.batch_key column",
    async needed() {
      return !(await columnExists("endorsements", "batch_key"));
    },
    async apply() {
      await pool.query("ALTER TABLE endorsements ADD COLUMN batch_key VARCHAR(40) NULL");
    },
  },
  {
    name: "endorsements.reply_to_id column",
    async needed() {
      return !(await columnExists("endorsements", "reply_to_id"));
    },
    async apply() {
      await pool.query("ALTER TABLE endorsements ADD COLUMN reply_to_id INT NULL");
    },
  },
  {
    name: "organization_documents.title column",
    async needed() {
      return !(await columnExists("organization_documents", "title"));
    },
    async apply() {
      await pool.query("ALTER TABLE organization_documents ADD COLUMN title VARCHAR(255) NULL");
    },
  },
  {
    name: "organization_documents.description column",
    async needed() {
      return !(await columnExists("organization_documents", "description"));
    },
    async apply() {
      await pool.query("ALTER TABLE organization_documents ADD COLUMN description TEXT NULL");
    },
  },
  {
    name: "organization_documents.hidden column",
    async needed() {
      return !(await columnExists("organization_documents", "hidden"));
    },
    async apply() {
      await pool.query("ALTER TABLE organization_documents ADD COLUMN hidden BOOLEAN NOT NULL DEFAULT 0");
    },
  },
  {
    name: "organization_documents.updated_at column",
    async needed() {
      return !(await columnExists("organization_documents", "updated_at"));
    },
    async apply() {
      await pool.query("ALTER TABLE organization_documents ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    },
  },
  {
    // An office can now send a document to / request one from the SAA office,
    // which has no row in `offices` — so the counterpart column may be NULL.
    name: "document_transmissions.office_id nullable (SAA as recipient)",
    async needed() {
      return !(await columnIsNullable("document_transmissions", "office_id"));
    },
    async apply() {
      await pool.query("ALTER TABLE document_transmissions MODIFY office_id INT NULL");
    },
  },
];

export async function ensureSchema() {
  const applied = [];
  for (const step of STEPS) {
    try {
      if (await step.needed()) {
        await step.apply();
        applied.push(step.name);
      }
    } catch (err) {
      // Don't take the whole API down over an upgrade step — say exactly
      // what failed and how to do it by hand, then keep going.
      console.error(`\n✗ Could not upgrade the database (${step.name}): ${err.message}`);
      console.error("  Your MySQL user needs ALTER / CREATE privileges, or import a fresh database/schema.sql.\n");
    }
  }
  return applied;
}
