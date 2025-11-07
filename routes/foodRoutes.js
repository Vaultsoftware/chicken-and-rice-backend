// backend/routes/foodRoutes.js
import express from "express";
import Food from "../models/Food.js";
import { upload } from "../middleware/upload.js";
import { putFile } from "../lib/firebaseAdmin.js";

const router = express.Router();

const log = (...a) => console.log("[foods]", ...a);
const err = (...a) => console.error("[foods]", ...a);

function sanitizeName(original = "file.bin") {
  const dot = original.lastIndexOf(".");
  const ext = dot >= 0 ? original.slice(dot).toLowerCase() : ".bin";
  const base = (dot >= 0 ? original.slice(0, dot) : original)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${Date.now()}-${base}${ext}`;
}

async function saveToStorage(file, folder = "foods") {
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

// list
router.get("/", async (req, res) => {
  try {
    const { state, lga, category } = req.query;
    let query = {};
    if (state && lga) query = { state, lgas: { $in: [lga] } };
    else if (state) query = { state };
    if (category) query.category = { $in: String(category).split(",") };
    const foods = await Food.find(query).sort({ createdAt: -1 });
    res.json(foods);
  } catch (e) {
    err("GET / failed:", e?.message || e);
    res.status(500).json({ error: "Failed to fetch foods" });
  }
});

router.get("/popular", async (_req, res) => {
  try {
    const foods = await Food.find({ isPopular: true }).sort({ createdAt: -1 });
    res.json(foods);
  } catch (e) {
    err("GET /popular failed:", e?.message || e);
    res.status(500).json({ error: "Failed to fetch popular foods" });
  }
});

router.get("/all", async (_req, res) => {
  try {
    const foods = await Food.find().sort({ createdAt: -1 });
    res.json(foods);
  } catch (e) {
    err("GET /all failed:", e?.message || e);
    res.status(500).json({ error: "Failed to fetch all foods" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const food = await Food.findById(req.params.id);
    if (!food) return res.status(404).json({ error: "Food not found" });
    res.json(food);
  } catch (e) {
    err("GET /:id failed:", e?.message || e);
    res.status(500).json({ error: "Failed to fetch food" });
  }
});

router.post("/", upload.single("imageFile"), async (req, res) => {
  try {
    log("POST / (fields):", req.body);
    if (req.file) log("POST / (file):", { name: req.file.originalname, type: req.file.mimetype, size: req.file.size });

    const {
      name, description, price, category, isAvailable, isPopular, state, lgas,
    } = req.body;

    let key = null;
    if (req.file) key = await saveToStorage(req.file, "foods");

    const food = new Food({
      name,
      description,
      price,
      category,
      isAvailable: isAvailable === "true" || isAvailable === true,
      isPopular: isPopular === "true" || isPopular === true,
      state,
      lgas: lgas ? JSON.parse(lgas) : [],
      image: key ? `/uploads/${key}` : null,
    });

    await food.save();
    log("POST / saved ✓", { id: food._id, image: food.image });
    res.status(201).json(food);
  } catch (e) {
    err("POST / failed:", e?.message || e);
    res.status(400).json({ error: e.message || "Failed to save food" });
  }
});

router.put("/:id", upload.single("imageFile"), async (req, res) => {
  try {
    log("PUT /:id (fields):", req.body);
    if (req.file) log("PUT /:id (file):", { name: req.file.originalname, type: req.file.mimetype, size: req.file.size });

    const {
      name, description, price, category, isAvailable, isPopular, state, lgas,
    } = req.body;

    const update = {
      name,
      description,
      price,
      category,
      isAvailable: isAvailable === "true" || isAvailable === true,
      isPopular: isPopular === "true" || isPopular === true,
      state,
      lgas: lgas ? JSON.parse(lgas) : [],
    };

    if (req.file) {
      const key = await saveToStorage(req.file, "foods");
      update.image = `/uploads/${key}`;
    }

    const food = await Food.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!food) return res.status(404).json({ error: "Food not found" });

    log("PUT /:id updated ✓", { id: food._id, image: food.image });
    res.json(food);
  } catch (e) {
    err("PUT /:id failed:", e?.message || e);
    res.status(400).json({ error: e.message || "Failed to update food" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const food = await Food.findByIdAndDelete(req.params.id);
    if (!food) return res.status(404).json({ error: "Food not found" });
    res.json({ message: "Food deleted successfully" });
  } catch (e) {
    err("DELETE /:id failed:", e?.message || e);
    res.status(500).json({ error: "Failed to delete food" });
  }
});

export default router;
