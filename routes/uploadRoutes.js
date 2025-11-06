// routes/uploadRoutes.js
import express from "express";
import { upload } from "../middleware/upload.js";
import { putFile } from "../lib/firebaseAdmin.js";

const router = express.Router();

/** Keep URL building consistent with frontend */
function getPublicBase() {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return base || "http://localhost:5000";
}

/** Avoid spaces/unsafe chars in object names */
function sanitizeName(original = "file.bin") {
  const dot = original.lastIndexOf(".");
  const ext = dot >= 0 ? original.slice(dot).toLowerCase() : ".bin";
  const stem = (dot >= 0 ? original.slice(0, dot) : original)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${Date.now()}-${stem || "file"}${ext}`;
}

/**
 * POST /api/upload
 * Form field: "file" (single)
 * Optional query/body: prefix (e.g., "foods/", "banners/")
 */
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const f = req.file;
    if (!f) return res.status(400).json({ ok: false, error: "no file" });

    // Generate final object key (optionally with a prefix folder)
    const prefix = String(req.query.prefix || req.body?.prefix || "")
      .replace(/^\/*/, "")
      .replace(/\.*\.\/*/g, "") // prevent ../
      .replace(/[^a-z0-9/_-]+/gi, "");
    const name = sanitizeName(f.originalname || "file.bin");
    const objectKey = prefix ? `${prefix.replace(/\/+$/, "")}/${name}` : name;

    // Save to Firebase Storage (GCS)
    await putFile({
      filename: objectKey,
      buffer: f.buffer,                 // from memoryStorage
      contentType: f.mimetype || "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
    });

    const base = getPublicBase();
    const relative = `/uploads/${encodeURI(objectKey)}`;
    const url = `${base}${relative}`;

    return res.json({
      ok: true,
      filename: objectKey,
      path: relative, // consumable by your /uploads proxy
      url,            // absolute URL for clients that need it
      contentType: f.mimetype,
      size: f.size,
    });
  } catch (e) {
    console.error("upload error:", e?.message || e);
    return res.status(500).json({ ok: false, error: e?.message || "upload failed" });
  }
});

export default router;
