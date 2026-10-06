import { hashPassword } from "../services/passwordWorker.js";
import { pool } from "../config/db.js";

// Never select password_hash into a shape that could get serialized back
// to the client by accident — it's fetched on its own, only where needed.
const SAFE_COLUMNS = `id, code, name, email, type, department, status, is_demo,
  avatar_file_id, password_changed_at, last_login_at, created_at`;

export async function findPortalUserById(id) {
  const [rows] = await pool.query(`SELECT ${SAFE_COLUMNS} FROM users WHERE id = ?`, [id]);
  return rows[0] || null;
}

export async function findPortalUserByEmail(email) {
  const [rows] = await pool.query(
    `SELECT ${SAFE_COLUMNS}, password_hash FROM users WHERE email = ? LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

export async function touchLastLogin(id) {
  await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = ?", [id]);
}

export async function getPasswordHash(id) {
  const [rows] = await pool.query("SELECT password_hash FROM users WHERE id = ?", [id]);
  return rows[0]?.password_hash || null;
}

// A user changing their own password also stamps password_changed_at,
// which is what tells the portal this account is no longer on the
// admin-issued password and can stop nagging about it.
export async function updateOwnPassword(id, plainPassword) {
  const hash = await hashPassword(plainPassword, 10);
  const [result] = await pool.query(
    "UPDATE users SET password_hash = ?, password_changed_at = NOW() WHERE id = ?",
    [hash, id]
  );
  return result.affectedRows > 0;
}

// Name and profile picture only. Email is the login credential and type is
// what gates access, so neither is editable here — both stay the admin's
// to set in User Management.
export async function updateOwnProfile(id, { name, avatarFileId }) {
  const [result] = await pool.query(
    "UPDATE users SET name = ?, avatar_file_id = ? WHERE id = ?",
    [name, avatarFileId ?? null, id]
  );
  return result.affectedRows > 0;
}

export async function getAvatarFile(userId) {
  const [rows] = await pool.query(
    `SELECT f.* FROM users u JOIN uploaded_files f ON f.id = u.avatar_file_id WHERE u.id = ?`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * FILE ACCESS CONTROL FOR PORTAL USERS
 * ───────────────────────────────────────────────────────────────────────
 * The upload pipeline is shared with the Admin Panel on purpose (one
 * storage path, one viewer, one download route — see requireAnyAuth). But
 * "signed in" is not enough authorization on its own: uploaded_files ids
 * are sequential, so without this check any student could walk
 * /api/uploads/1/view … /api/uploads/999/view and read other people's
 * submitted documents, other students' scholarship requirements, or the
 * admin's chat attachments.
 *
 * So a portal user may only read a file they can actually reach through
 * their own portal. Each branch below mirrors exactly one screen; if a
 * file isn't attached to something that user is entitled to see, the
 * answer is no. The admin is unaffected — this is only consulted for
 * portal identities.
 */
export async function canPortalUserAccessFile(user, fileId) {
  const id = Number(fileId);
  if (!Number.isFinite(id)) return false;

  const audienceKey = { student: "students", alumni: "alumni", offices: "offices" }[user.type] || user.type;

  const checks = [
    // Their own profile picture.
    ["SELECT 1 FROM users WHERE id = ? AND avatar_file_id = ?", [user.id, id]],

    // A file they uploaded themselves — what lets the person preview the
    // photo/file they just attached, before it is part of any post or
    // message yet. (uploaded_by_user_id is only ever set from the caller's
    // own session, never from the request.)
    ["SELECT 1 FROM uploaded_files WHERE id = ? AND uploaded_by_user_id = ?", [id, user.id]],

    // The logo shown beside a Campus Feed post: the SAA office's own logo
    // (admin Settings) and the logo of any office with a visible post. This
    // is institutional branding shown on public posts, not a private photo.
    ["SELECT 1 FROM admins WHERE avatar_file_id = ?", [id]],
    [
      `SELECT 1 FROM campus_feed_posts p
       JOIN offices o ON o.id = p.author_office_id
       JOIN users u ON u.id = o.user_id
       WHERE p.hidden = 0 AND u.avatar_file_id = ?`,
      [id],
    ],

    // Attachments on a published announcement aimed at their audience.
    // The id is passed as its plain decimal text ("18"), which is itself
    // valid JSON for the number 18 — that's the form JSON_CONTAINS wants
    // for its search argument. (`CAST(? AS JSON)` looks more explicit but
    // is a MySQL-only spelling: MariaDB has no JSON *type*, so it's a
    // syntax error there and would break this check on half the databases
    // this project is documented to run on.)
    [
      `SELECT 1 FROM announcements
       WHERE status = 'published'
         AND JSON_CONTAINS(audience, JSON_QUOTE(?))
         AND attachments IS NOT NULL
         AND JSON_CONTAINS(attachments, ?)`,
      [audienceKey, String(id)],
    ],

    // Campus Feed photos — campus-wide content, visible to any signed-in
    // portal account.
    ["SELECT 1 FROM campus_feed_media WHERE file_id = ?", [id]],

    // Application forms / documents the SAA attached to an open scholarship.
    [
      `SELECT 1 FROM scholarship_attachments sa
       JOIN scholarships s ON s.id = sa.scholarship_id
       WHERE sa.file_id = ? AND s.status = 'active'`,
      [id],
    ],

    // Their own Document Queue ticket: the copy they submitted, and the
    // signed copy released back to them.
    [
      `SELECT 1 FROM document_queue_tickets
       WHERE requester_user_id = ? AND (file_id = ? OR signed_file_id = ?)`,
      [user.id, id, id],
    ],

    // A routed office's signed copy, but only on their own ticket.
    [
      `SELECT 1 FROM esignature_routes r
       JOIN document_queue_tickets t ON t.id = r.ticket_id
       WHERE t.requester_user_id = ? AND r.signed_file_id = ?`,
      [user.id, id],
    ],

    // Requirement files they uploaded with their own scholarship application.
    [
      `SELECT 1 FROM scholarship_applicant_files f
       JOIN scholarship_applicants a ON a.id = f.applicant_id
       WHERE a.user_id = ? AND f.file_id = ?`,
      [user.id, id],
    ],

    // Proof files on their own achievement submission.
    [
      `SELECT 1 FROM achievement_files af
       JOIN achievements a ON a.id = af.achievement_id
       WHERE a.user_id = ? AND af.file_id = ?`,
      [user.id, id],
    ],

    // Attachments inside their own SAA Chat thread — either direction.
    [
      `SELECT 1 FROM chat_messages m
       JOIN chat_conversations c ON c.id = m.conversation_id
       WHERE c.other_user_id = ? AND m.file_id = ? AND m.unsent_at IS NULL`,
      [user.id, id],
    ],
  ];

  // Office Portal — everything scoped to the office this account runs,
  // resolved once via users.id -> offices.user_id (never trust a
  // client-supplied officeId for this).
  if (user.type === "offices") {
    checks.push(
      // The current working copy of any ticket routed to their office for
      // an e-signature, whichever stage it's at (unsigned original, this
      // route's own signed copy, or the ticket's overall latest cumulative
      // copy) — they need to see it to sign it, even on a ticket someone
      // else filed.
      [
        `SELECT 1 FROM esignature_routes r
         JOIN document_queue_tickets t ON t.id = r.ticket_id
         JOIN offices o ON o.id = r.office_id
         WHERE o.user_id = ? AND (t.file_id = ? OR t.signed_file_id = ? OR r.signed_file_id = ?)`,
        [user.id, id, id, id],
      ],
      // The signature images of every signer on a ticket routed to their
      // office — needed to rebuild the document without their own old
      // signature (re-sign) while keeping everyone else's on it.
      [
        `SELECT 1 FROM esignature_layers l
         JOIN esignature_routes r ON r.ticket_id = l.ticket_id
         JOIN offices o ON o.id = r.office_id
         WHERE o.user_id = ? AND l.signature_file_id = ?`,
        [user.id, id],
      ],
      // Any inter-office transmission they're a party to, either direction.
      // (Their own Document Repository files are NOT here: those live in
      // document_files — a different id space from uploaded_files — and are
      // served by their own ownership-checked endpoint, never /api/uploads.)
      [
        `SELECT 1 FROM transmission_files tf
         JOIN document_transmissions t ON t.id = tf.transmission_id
         JOIN offices o ON o.id = t.office_id OR o.id = t.from_office_id
         WHERE o.user_id = ? AND tf.file_id = ?`,
        [user.id, id],
      ],
      // Endorsements they're the source or recipient office of.
      [
        `SELECT 1 FROM endorsement_files ef
         JOIN endorsements e ON e.id = ef.endorsement_id
         JOIN offices o ON o.id = e.office_id OR o.id = e.source_office_id
         WHERE o.user_id = ? AND ef.file_id = ?`,
        [user.id, id],
      ]
    );
  }

  // The Student Leaders Directory is a view-only module for both students
  // and offices (offices additionally get to manage their own one
  // organization, through its own dedicated, ownership-checked endpoints —
  // this is only about viewing/downloading the files themselves).
  if (user.type === "student" || user.type === "offices") {
    checks.push(
      ["SELECT 1 FROM organization_documents WHERE file_id = ? AND hidden = 0", [id]],
      [
        `SELECT 1 FROM student_organizations
         WHERE org_logo_file_id = ? OR college_logo_file_id = ? OR psu_logo_file_id = ? OR cbl_file_id = ?`,
        [id, id, id, id],
      ],
      ["SELECT 1 FROM org_officers WHERE photo_file_id = ?", [id]]
    );
  }

  for (const [sql, params] of checks) {
    const [rows] = await pool.query(`${sql} LIMIT 1`, params);
    if (rows.length > 0) return true;
  }
  return false;
}
