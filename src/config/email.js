import nodemailer from "nodemailer";
import { env } from "./env.js";

let transporter = null;

export function isEmailConfigured() {
  return env.email.enabled && env.email.host && env.email.user && env.email.password;
}

function getTransporter() {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.email.host,
      port: env.email.port,
      secure: env.email.secure,
      auth: { user: env.email.user, pass: env.email.password },
    });
  }
  return transporter;
}

/**
 * Sends one email per recipient batch via BCC (so recipients can't see
 * each other's addresses). Never throws — a misconfigured or failing SMTP
 * server should never break the action that triggered the email (e.g.
 * publishing an announcement still succeeds even if mail delivery fails).
 * Returns { sent, failed, error, skippedReason }. `error` is only set when
 * a send was actually attempted and failed (as opposed to nothing being
 * configured, or there being no recipients to begin with) — callers use it
 * to tell "nothing to send" apart from "delivery is broken", which look
 * identical if you only check `sent === 0`.
 */
export async function sendBulkEmail({ recipients, subject, text, html }) {
  if (!isEmailConfigured()) {
    console.log(`[email] Skipped "${subject}" — EMAIL_ENABLED is off or SMTP isn't configured (see backend/.env).`);
    return { sent: 0, failed: 0, error: null, skippedReason: "not_configured" };
  }
  if (!recipients || recipients.length === 0) {
    return { sent: 0, failed: 0, error: null, skippedReason: "no_recipients" };
  }

  const BATCH_SIZE = 40; // stay well under most SMTP providers' per-message recipient limits
  const t = getTransporter();
  let sent = 0;
  let failed = 0;
  let lastError = null;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    try {
      await t.sendMail({
        from: env.email.from,
        to: env.email.from, // primary "to" is the sender; real recipients are BCC'd
        bcc: batch,
        subject,
        text,
        html,
      });
      sent += batch.length;
    } catch (err) {
      failed += batch.length;
      lastError = err;
      // Logged with the host/port so a Railway (or any host) deploy log
      // shows exactly what SMTP endpoint it tried and why it was refused —
      // this used to just say the batch size, which wasn't enough to tell
      // "wrong credentials" apart from "network/port blocked" apart from
      // "not configured at all".
      console.error(
        `[email] Failed to send "${subject}" to a batch of ${batch.length} via ${env.email.host}:${env.email.port} — ${err.code || "ERROR"}: ${err.message}`
      );
    }
  }
  return {
    sent,
    failed,
    error: lastError ? `${lastError.code ? lastError.code + ": " : ""}${lastError.message}` : null,
  };
}
