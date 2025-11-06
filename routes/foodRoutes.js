// routes/foodRoutes.js
import express from "express";
import Food from "../models/Food.js";
import { upload } from "../middleware/upload.js";
import { putFile } from "../lib/firebaseAdmin.js";

const router = express.Router();

/* --- helpers --- */
const toBool = (v) => {
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return false;
};
const toNum = (v) => (v === "" || v == null ? undefined : Number(v));
const parseMaybeJSON = (val, fallback = []) => {
  try { if (typeof val === "string") return JSON.parse(val); if (Array.isArray(val)) return val; } catch {}
  return fallback;
};
const sanitizeName = (original = "file.bin", prefix = "") => {
  const dot = original.lastIndexOf(".");
  const ext = dot >= 0 ? original.slice(dot).toLowerCase() : ".bin";
  const stem = (dot >= 0 ? original.slice(0, dot) : original)
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "file";
  const cleanPrefix = String(prefix).replace(/^\/+|\/+$/g, "");
  const base = `${Date.now()}-${stem}${ext}`;
  return cleanPrefix ? `${cleanPrefix}/${base}` : base;
};

/* --- DEBUG: log incoming multipart --- */
const debugMultipart = (req) => {
  const fields = Object.fromEntries(Object.entries(req.body || {}).map(([k, v]) => [k, String(v).slice(0, 120)]));
  const file = req.file ? {
    fieldname: req.file.fieldname,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    hasBuffer: !!req.file.buffer,
  } : null;
  console.log("📥 /api/foods multipart:", { fields, file });
};

/* --- list, get, etc (unchanged) --- */
router.get("/", async (req, res) => {
  try {
    const { state, lga, category } = req.query;
    const q = {};
    if (state && lga) { q.state = state; q.lgas = { $in: [lga] }; }
    else if (state) { q.state = state; }
    if (category) q.category = { $in: String(category).split(",") };
    const foods = await Food.find(q).sort({ createdAt: -1 });
    res.json(foods);
  } catch { res.status(500).json({ error: "Failed to fetch foods" }); }
});
router.get("/popular", async (_req, res) => {
  try { res.json(await Food.find({ isPopular: true }).sort({ createdAt: -1 })); }
  catch { res.status(500).json({ error: "Failed to fetch popular foods" }); }
});
router.get("/all", async (_req, res) => {
  try { res.json(await Food.find().sort({ createdAt: -1 })); }
  catch { res.status(500).json({ error: "Failed to fetch all foods" }); }
});
router.get("/:id", async (req, res) => {
  try {
    const food = await Food.findById(req.params.id);
    if (!food) return res.status(404).json({ error: "Food not found" });
    res.json(food);
  } catch { res.status(500).json({ error: "Failed to fetch food" }); }
});

/* --- CREATE --- */
router.post("/", upload.single("imageFile"), async (req, res) => {
  try {
    debugMultipart(req); // ← crucial

    const name = req.body?.name?.trim();
    const priceNum = toNum(req.body?.price);

    const errors = [];
    if (!name) errors.push("name is required");
    if (priceNum == null || Number.isNaN(priceNum)) errors.push("price must be a number");

    if (errors.length) return res.status(400).json({ error: "validation", details: errors });

    // optional fields
    const category = req.body?.category;
    const isAvailable = toBool(req.body?.isAvailable);
    const isPopular = toBool(req.body?.isPopular) || toBool(req.body?.popular) || toBool(req.body?.featured);
    const state = req.body?.state;
    const lgas = parseMaybeJSON(req.body?.lgas, []);

    // save image (if present)
    let imagePath = null;
    if (req.file?.buffer) {
      const key = sanitizeName(req.file.originalname || "image.bin", "foods");
      await putFile({
        filename: key,
        buffer: req.file.buffer,
        contentType: req.file.mimetype || "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
      });
      imagePath = `/uploads/${key}`;
    }

    const doc = await Food.create({
      name,
      description: req.body?.description || "",
      price: priceNum,
      category,
      isAvailable,
      isPopular,
      state,
      lgas,
      image: imagePath,
    });
    res.status(201).json(doc);
  } catch (err) {
    console.error("❌ POST /foods failed:", err?.message || err);
    res.status(400).json({ error: err?.message || "Failed to create food" });
  }
});

/* --- UPDATE --- */
router.put("/:id", upload.single("imageFile"), async (req, res) => {
  try {
    debugMultipart(req);

    const existing = await Food.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Food not found" });

    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.price !== undefined) {
      const n = toNum(req.body.price, existing.price);
      if (Number.isNaN(n)) return res.status(400).json({ error: "price must be a number" });
      updates.price = n;
    }
    if (req.body.category !== undefined) updates.category = req.body.category;
    if (req.body.isAvailable !== undefined) updates.isAvailable = toBool(req.body.isAvailable);
    const popularFlag = [req.body.isPopular, req.body.popular, req.body.featured].find((v) => v !== undefined);
    if (popularFlag !== undefined) updates.isPopular = toBool(popularFlag);
    if (req.body.state !== undefined) updates.state = req.body.state;
    if (req.body.lgas !== undefined) updates.lgas = parseMaybeJSON(req.body.lgas, existing.lgas || []);

    if (req.file?.buffer) {
      const key = sanitizeName(req.file.originalname || "image.bin", "foods");
      await putFile({
        filename: key,
        buffer: req.file.buffer,
        contentType: req.file.mimetype || "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
      });
      updates.image = `/uploads/${key}`;
    }

    const updated = await Food.findByIdAndUpdate(req.params.id, updates, { new: true });
    res.json(updated);
  } catch (err) {
    console.error("❌ PUT /foods failed:", err?.message || err);
    res.status(400).json({ error: err?.message || "Failed to update food" });
  }
});

/* --- DELETE --- */
router.delete("/:id", async (req, res) => {
  try {
    const food = await Food.findByIdAndDelete(req.params.id);
    if (!food) return res.status(404).json({ error: "Food not found" });
    res.json({ message: "Food deleted successfully" });
  } catch {
    res.status(500).json({ error: "Failed to delete food" });
  }
});

export default router;
