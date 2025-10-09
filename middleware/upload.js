// backend/middleware/upload.js
import multer from "multer";

const storage = multer.memoryStorage();

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
]);

function fileFilter(_req, file, cb) {
  if (!file?.mimetype) return cb(new Error("Missing mimetype"));
  if (ALLOWED.has(file.mimetype)) return cb(null, true);
  cb(new Error(`Unsupported file type: ${file.mimetype}`));
}

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
    files: 1,
  },
});
