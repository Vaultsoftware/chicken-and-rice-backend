// ============================================================================
// backend/routes/img.js  (RegExp route variant — no string catch-all)
// Lightweight image optimizer/resizer for files in GCS via firebase-admin
// GET /img/<objectKey>?w=640&q=75&fmt=auto
// ============================================================================
import express from "express";
import sharp from "sharp";
import { statObject } from "../lib/firebaseAdmin.js";

const router = express.Router();
const MAX_W = Number(process.env.IMG_MAX_WIDTH || 2560);
const DEFAULT_Q = Number(process.env.IMG_DEFAULT_QUALITY || 70);

const OK_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/gif",
]);

function clampInt(v, min, max, d = undefined) {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function pickFormat({ accept, fmt }) {
  if (fmt && fmt !== "auto") return fmt;
  const a = String(accept || "").toLowerCase();
  if (a.includes("image/avif")) return "avif";
  if (a.includes("image/webp")) return "webp";
  return "auto";
}

// NOTE: Mounted at /img (see server.js). This RegExp matches "/<anything>"
router.get(/^\/(.+)$/, async (req, res) => {
  try {
    // req.params[0] contains the whole "<objectKey>" segment after /img/
    const rawKey = req.params[0] || "";
    const key = decodeURIComponent(String(rawKey).replace(/^\/+/, ""));
    if (!key) return res.status(400).json({ error: "missing key" });

    const info = await statObject(key);
    if (!info) return res.status(404).json({ error: "not found" });

    const { file, meta } = info;
    const ct = meta?.contentType || "application/octet-stream";
    const isImage = OK_TYPES.has(ct);

    res.setHeader("Cache-Control", meta?.cacheControl || "public, max-age=31536000, immutable");
    res.setHeader("Vary", "Accept");

    if (!isImage) {
      const stream = file.createReadStream();
      stream.on("error", (e) => {
        console.error("img passthrough error:", e?.message || e);
        if (!res.headersSent) res.status(500).json({ error: "stream failed" });
      });
      res.setHeader("Content-Type", ct);
      return stream.pipe(res);
    }

    const w = clampInt(req.query.w, 1, MAX_W);
    const fmt = pickFormat({ accept: req.headers["accept"], fmt: (req.query.fmt || "").toString().toLowerCase() });
    const q  = clampInt(req.query.q, 30, 95, DEFAULT_Q);

    const read = file.createReadStream();
    read.on("error", (e) => {
      console.error("gcs read error:", key, e?.message || e);
      if (!res.headersSent) res.status(500).json({ error: "stream failed" });
    });

    let pipeline = sharp();
    if (w) pipeline = pipeline.resize({ width: w, withoutEnlargement: true, fastShrinkOnLoad: true });

    if (fmt === "avif")       pipeline = pipeline.avif({ quality: q, effort: 4 });
    else if (fmt === "webp")  pipeline = pipeline.webp({ quality: q });
    else if (fmt === "jpeg")  pipeline = pipeline.jpeg({ quality: q, mozjpeg: true });
    else if (fmt === "png")   pipeline = pipeline.png();
    else                      pipeline = pipeline.toFormat("webp", { quality: q }); // auto fallback

    const outType = fmt === "avif" ? "image/avif"
                  : fmt === "webp" ? "image/webp"
                  : fmt === "jpeg" ? "image/jpeg"
                  : fmt === "png"  ? "image/png"
                  : "image/webp";

    res.setHeader("Content-Type", outType);
    return read.pipe(pipeline).pipe(res);
  } catch (e) {
    console.error("img route error:", e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: "failed" });
  }
});

export default router;
