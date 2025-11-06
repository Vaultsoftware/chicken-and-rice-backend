// ============================================================================
// backend/lib/media.js
// Centralized helpers for saving files to Firebase Storage and returning paths
// ============================================================================
import { putFile } from "./firebaseAdmin.js";

function slugifyBase(name) {
  return String(name || "file")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "file";
}

export function buildObjectKey(originalname = "file.bin", prefix = "") {
  const dot = originalname.lastIndexOf(".");
  const ext = dot >= 0 ? originalname.slice(dot).toLowerCase() : ".bin";
  const stem = slugifyBase(dot >= 0 ? originalname.slice(0, dot) : originalname);
  const ts = Date.now();
  const cleanPrefix = String(prefix || "").replace(/^\/+|\/+$/g, "");
  const base = `${ts}-${stem}${ext}`;
  return cleanPrefix ? `${cleanPrefix}/${base}` : base;
}

/**
 * Saves a buffer to Firebase Storage and returns:
 *   { objectKey: "foods/...", path: "/uploads/foods/..." }
 */
export async function saveToStorage({ buffer, originalname, mimetype, prefix }) {
  if (!buffer) throw new Error("saveToStorage: buffer is required");
  const objectKey = buildObjectKey(originalname || "file.bin", prefix || "");
  await putFile({
    filename: objectKey,
    buffer,
    contentType: mimetype || "application/octet-stream",
    cacheControl: "public, max-age=31536000, immutable",
  });
  return { objectKey, path: `/uploads/${objectKey}` };
}

export const toBool = (v) => {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return false;
};

export const toNum = (v, d = undefined) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const parseMaybeJSON = (val, fallback = []) => {
  try {
    if (typeof val === "string") return JSON.parse(val);
    if (Array.isArray(val)) return val;
  } catch {}
  return fallback;
};
