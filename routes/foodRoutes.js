// ============================================================================
// backend/routes/foodRoutes.js
// ============================================================================
import express from "express";
import Food from "../models/Food.js";
import { upload } from "../middleware/upload.js";
import { putFile, deleteObject } from "../lib/firebaseAdmin.js";

const router = express.Router();
const sanitize = (name = "file.bin") => {
  const dot = name.lastIndexOf(".");
  const base = (dot === -1 ? name : name.slice(0, dot)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "file";
  const ext = dot === -1 ? ".bin" : name.slice(dot).toLowerCase();
  return `${Date.now()}-${base}${ext}`;
};
const makeKey = (prefix, originalname) => `${prefix}/${sanitize(originalname || "file.bin")}`;

router.get("/", async (req, res) => {
  try {
    const { state, lga, category } = req.query;
    let query = {};
    if (state && lga) query = { state, lgas: { $in: [lga] } };
    else if (state) query = { state };
    if (category) query.category = { $in: String(category).split(",") };
    const foods = await Food.find(query).sort({ createdAt: -1 });
    res.json(foods);
  } catch (err) {
    console.error("GET /foods error:", err?.message || err);
    res.status(500).json({ error: "Failed to fetch foods" });
  }
});

router.get("/popular", async (_req, res) => {
  try {
    const foods = await Food.find({ isPopular: true }).sort({ createdAt: -1 });
    res.json(foods);
  } catch (e) {
    console.error("GET /foods/popular error:", e?.message || e);
    res.status(500).json({ error: "Failed to fetch popular foods" });
  }
});
router.get("/all", async (_req, res) => {
  try {
    const foods = await Food.find().sort({ createdAt: -1 });
    res.json(foods);
  } catch (e) {
    console.error("GET /foods/all error:", e?.message || e);
    res.status(500).json({ error: "Failed to fetch all foods" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const food = await Food.findById(req.params.id);
    if (!food) return res.status(404).json({ error: "Food not found" });
    res.json(food);
  } catch (e) {
    console.error("GET /foods/:id error:", e?.message || e);
    res.status(500).json({ error: "Failed to fetch food" });
  }
});

router.post("/", upload.single("imageFile"), async (req, res) => {
  try {
    console.log("📥 /api/foods multipart:", {
      fields: Object.fromEntries(Object.entries(req.body || {}).map(([k, v]) => [k, String(v).slice(0, 200)])),
      file: req.file ? {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        hasBuffer: !!req.file.buffer,
      } : null,
    });

    const { name, description, price, category, isAvailable, isPopular, state, lgas } = req.body;

    let imagePath = null;
    if (req.file?.buffer) {
      const key = makeKey("foods", req.file.originalname);
      await putFile({ filename: key, buffer: req.file.buffer, contentType: req.file.mimetype });
      imagePath = `/uploads/${key}`;
    }

    const food = new Food({
      name,
      description,
      price,
      category,
      isAvailable: isAvailable === "true" || isAvailable === true,
      isPopular: isPopular === "true" || isPopular === true,
      state,
      lgas: lgas ? JSON.parse(lgas) : [],
      image: imagePath,
    });

    await food.save();
    res.status(201).json(food);
  } catch (err) {
    console.error("❌ POST /foods failed:", err?.message || err);
    res.status(400).json({ error: err?.message || "Failed to save food" });
  }
});

router.put("/:id", upload.single("imageFile"), async (req, res) => {
  try {
    console.log("📥 PUT /api/foods/:id multipart:", {
      id: req.params.id,
      fields: Object.fromEntries(Object.entries(req.body || {}).map(([k, v]) => [k, String(v).slice(0, 200)])),
      file: req.file ? {
        fieldname: req.file.fieldname, originalname: req.file.originalname,
        mimetype: req.file.mimetype, size: req.file.size, hasBuffer: !!req.file.buffer
      } : null,
    });

    const { name, description, price, category, isAvailable, isPopular, state, lgas } = req.body;
    const updateData = {
      name, description, price, category,
      isAvailable: isAvailable === "true" || isAvailable === true,
      isPopular: isPopular === "true" || isPopular === true,
      state, lgas: lgas ? JSON.parse(lgas) : [],
    };

    if (req.file?.buffer) {
      const key = makeKey("foods", req.file.originalname);
      await putFile({ filename: key, buffer: req.file.buffer, contentType: req.file.mimetype });
      updateData.image = `/uploads/${key}`;
    }

    const food = await Food.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!food) return res.status(404).json({ error: "Food not found" });
    res.json(food);
  } catch (err) {
    console.error("❌ PUT /foods/:id failed:", err?.message || err);
    res.status(400).json({ error: err?.message || "Failed to update food" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const food = await Food.findByIdAndDelete(req.params.id);
    if (!food) return res.status(404).json({ error: "Food not found" });
    if (food.image) await deleteObject(food.image);
    res.json({ message: "Food deleted successfully" });
  } catch (e) {
    console.error("DELETE /foods/:id error:", e?.message || e);
    res.status(500).json({ error: "Failed to delete food" });
  }
});

export default router;