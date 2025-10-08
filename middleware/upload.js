// backend/middleware/upload.js
import multer from "multer";
import path from "path";

export function sanitizeName(original) {
  const ext = path.extname(original || "").toLowerCase();
  const base = path.basename(original || "", ext);
  const safe = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${Date.now()}-${safe || "file"}${ext || ""}`;
}

// In-memory; no disk/volume usage
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});
