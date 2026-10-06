import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});

// Document Repository (and every other upload surface in the app — they
// all share this one pipeline) accepts any file format the admin drops
// in. No extension allowlist here on purpose; only the size cap applies.
export const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });
export { UPLOAD_DIR };
