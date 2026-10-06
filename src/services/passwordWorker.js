import { Worker } from "node:worker_threads";
import os from "node:os";
import bcrypt from "bcryptjs";

/**
 * PASSWORD CHECKING WITHOUT FREEZING THE SITE
 * ───────────────────────────────────────────────────────────────────────
 * Checking a password with bcrypt is deliberately slow (that is what makes
 * stolen hashes hard to crack) — and bcryptjs does it in plain JavaScript on
 * the server's ONE main thread. One sign-in is unnoticeable, but when many
 * people sign in at once (a whole class at the start of a session) those
 * checks queue up on the main thread and every other request waits behind
 * them: measured, 30 simultaneous sign-ins froze everyone for ~2 seconds and
 * 150 for ~5.
 *
 * So the student/alumni portal's password work is handed to a small pool of
 * worker threads. The main thread keeps answering everybody else, and on a
 * machine with several cores the checks also run in parallel. Same library,
 * same hashes, same result — just not on the main thread. No new package.
 *
 * If a worker can't be started or misbehaves, the check simply runs the old
 * way on the main thread instead: a sign-in is never refused because of
 * this helper. (The Admin Panel's own sign-in is untouched — one account, and
 * it doesn't go through here.)
 */

const POOL_SIZE =
  Number(process.env.PASSWORD_WORKERS) ||
  Math.max(1, Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1));
const TASK_TIMEOUT_MS = 20_000;

const workers = []; // { worker, busy }
const pending = new Map(); // id -> { resolve, reject, slot, timer }
let nextId = 1;

function dropWorker(slot, reason) {
  const i = workers.indexOf(slot);
  if (i !== -1) workers.splice(i, 1);
  for (const [id, task] of pending) {
    if (task.slot === slot) {
      clearTimeout(task.timer);
      pending.delete(id);
      task.reject(new Error(reason));
    }
  }
}

function spawn() {
  const worker = new Worker(new URL("./passwordWorker.thread.js", import.meta.url));
  const slot = { worker, busy: 0 };
  worker.unref(); // these threads alone must never keep the server process alive
  worker.on("message", ({ id, result, error }) => {
    const task = pending.get(id);
    if (!task) return;
    pending.delete(id);
    clearTimeout(task.timer);
    slot.busy = Math.max(0, slot.busy - 1);
    if (error) task.reject(new Error(error));
    else task.resolve(result);
  });
  worker.on("error", () => dropWorker(slot, "password worker crashed"));
  worker.on("exit", () => dropWorker(slot, "password worker exited"));
  workers.push(slot);
  return slot;
}

function pick() {
  // Start workers on demand up to the pool size; otherwise use the least busy one.
  if (workers.length < POOL_SIZE) return spawn();
  return workers.reduce((a, b) => (b.busy < a.busy ? b : a));
}

function run(payload) {
  return new Promise((resolve, reject) => {
    let slot;
    try {
      slot = pick();
    } catch (err) {
      reject(err);
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      slot.busy = Math.max(0, slot.busy - 1);
      reject(new Error("password worker timed out"));
    }, TASK_TIMEOUT_MS);
    pending.set(id, { resolve, reject, slot, timer });
    slot.busy += 1;
    slot.worker.postMessage({ id, ...payload });
  });
}

/** Same answer as bcrypt.compare(password, hash) — computed off the main thread. */
export async function comparePassword(password, hash) {
  try {
    return await run({ op: "compare", password, hash });
  } catch {
    return bcrypt.compare(password, hash);
  }
}

/** Same as bcrypt.hash(password, rounds) — computed off the main thread. */
export async function hashPassword(password, rounds = 10) {
  try {
    return await run({ op: "hash", password, rounds });
  } catch {
    return bcrypt.hash(password, rounds);
  }
}

export function passwordWorkerCount() {
  return workers.length;
}
