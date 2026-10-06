// Runs inside a worker thread (see passwordWorker.js). Does one thing: the
// slow, CPU-heavy bcrypt maths, so the main thread never has to.
import { parentPort } from "node:worker_threads";
import bcrypt from "bcryptjs";

parentPort.on("message", ({ id, op, password, hash, rounds }) => {
  try {
    const result = op === "compare" ? bcrypt.compareSync(password, hash) : bcrypt.hashSync(password, rounds);
    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({ id, error: String(err?.message || err) });
  }
});
