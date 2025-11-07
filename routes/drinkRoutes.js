// backend/routes/drinkRoutes.js
import express from "express";
import Drink from "../models/Drink.js";
import { upload } from "../middleware/upload.js";
import { putFile } from "../lib/firebaseAdmin.js";

const router = express.Router();
const log = (...a) => console.log("[drinks]", ...a);
const err = (...a) => console.error("[drinks]", ...a);

function sanitizeName(original = "file.bin") {
  const dot = original.lastIndexOf(".");
  const ext = dot >= 0 ? original.slice(dot).toLowerCase() : ".bin";
  const base = (dot >= 0 ? original.slice(0, dot) : original)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${Date.now()}-${base}${ext}`;
}

async function saveToStorage(file, folder = "drinks") {
  if (!file?.buffer || !file?.mimetype) throw new Error("Missing file buffer/mimetype");
  const safe = sanitizeName(file.originalname || "image.jpg");
  const key = `${folder}/${safe}`;
  log("uploading →", key, `(${file.mimetype}, ${file.size || file.buffer.length} bytes)`);
  await putFile({
    filename: key,
    buffer: file.buffer,
    contentType: file.mimetype,
    cacheControl: "public, max-age=31536000, immutable",
  });
  log("uploaded ✓", key);
  return key;
}

router.post("/", upload.single("imageFile"), async (req, res) => {
  try {
    log("POST / (fields):", req.body);
    if (req.file) log("POST / (file):", { name: req.file.originalname, type: req.file.mimetype, size: req.file.size });

    const { name, price } = req.body;
    let key = null;
    if (req.file) key = await saveToStorage(req.file, "drinks");

    const drink = new Drink({
      name,
      price,
      image: key ? `/uploads/${key}` : undefined,
    });

    await drink.save();
    log("POST / saved ✓", { id: drink._id, image: drink.image });
    res.status(201).json(drink);
  } catch (e) {
    err("POST / failed:", e?.message || e);
    res.status(400).json({ error: e.message || "Failed to save drink" });
  }
});

router.get("/", async (_req, res) => {
  try {
    const drinks = await Drink.find().sort({ createdAt: -1 });
    res.json(drinks);
  } catch (e) {
    err("GET / failed:", e?.message || e);
    res.status(500).json({ error: e.message || "Failed to fetch drinks" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const drink = await Drink.findById(req.params.id);
    if (!drink) return res.status(404).json({ error: "Drink not found" });
    res.json(drink);
  } catch (e) {
    err("GET /:id failed:", e?.message || e);
    res.status(500).json({ error: e.message || "Failed to fetch drink" });
  }
});

router.put("/:id", upload.single("imageFile"), async (req, res) => {
  try {
    log("PUT /:id (fields):", req.body);
    if (req.file) log("PUT /:id (file):", { name: req.file.originalname, type: req.file.mimetype, size: req.file.size });

    const { name, price } = req.body;
    const updates = { name, price };

    if (req.file) {
      const key = await saveToStorage(req.file, "drinks");
      updates.image = `/uploads/${key}`;
    }

    const drink = await Drink.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!drink) return res.status(404).json({ error: "Drink not found" });

    log("PUT /:id updated ✓", { id: drink._id, image: drink.image });
    res.json(drink);
  } catch (e) {
    err("PUT /:id failed:", e?.message || e);
    res.status(400).json({ error: e.message || "Failed to update drink" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const drink = await Drink.findByIdAndDelete(req.params.id);
    if (!drink) return res.status(404).json({ error: "Drink not found" });
    res.json({ message: "Drink deleted" });
  } catch (e) {
    err("DELETE /:id failed:", e?.message || e);
    res.status(500).json({ error: "Failed to delete drink" });
  }
});

export default router;
