// routes/foodRoutes.js
import express from "express";
import Food from "../models/Food.js";
import { upload } from "../middleware/upload.js";
import { putFile } from "../lib/firebaseAdmin.js";

const router = express.Router();

// ---- helpers ----
const sanitize = (name = "file.bin") => {
  const dot = name.lastIndexOf(".");
  const base = (dot === -1 ? name : name.slice(0, dot)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "file";
  const ext  = dot === -1 ? ".bin" : name.slice(dot).toLowerCase();
  return `${Date.now()}-${base}${ext}`;
};
const makeKey = (prefix, originalname) => `${prefix}/${sanitize(originalname || "file.bin")}`;

// ---- Get all foods OR filter by state/lga/category ----
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
    res.status(500).json({ error: "Failed to fetch foods" });
  }
});

// ---- Get only popular foods ----
router.get("/popular", async (_req, res) => {
  try {
    const foods = await Food.find({ isPopular: true }).sort({ createdAt: -1 });
    res.json(foods);
  } catch {
    res.status(500).json({ error: "Failed to fetch popular foods" });
  }
});

// ---- Get all foods (shortcut) ----
router.get("/all", async (_req, res) => {
  try {
    const foods = await Food.find().sort({ createdAt: -1 });
    res.json(foods);
  } catch {
    res.status(500).json({ error: "Failed to fetch all foods" });
  }
});

// ---- Get a single food by ID ----
router.get("/:id", async (req, res) => {
  try {
    const food = await Food.findById(req.params.id);
    if (!food) return res.status(404).json({ error: "Food not found" });
    res.json(food);
  } catch {
    res.status(500).json({ error: "Failed to fetch food" });
  }
});

// ---- Create food ----
router.post("/", upload.single("imageFile"), async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      category,
      isAvailable,
      isPopular,
      state,
      lgas,
    } = req.body;

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
    res.status(400).json({ error: err.message || "Failed to save food" });
  }
});

// ---- Update food ----
router.put("/:id", upload.single("imageFile"), async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      category,
      isAvailable,
      isPopular,
      state,
      lgas,
    } = req.body;

    const updateData = {
      name,
      description,
      price,
      category,
      isAvailable: isAvailable === "true" || isAvailable === true,
      isPopular: isPopular === "true" || isPopular === true,
      state,
      lgas: lgas ? JSON.parse(lgas) : [],
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
    res.status(400).json({ error: err.message || "Failed to update food" });
  }
});

// ---- Delete food ----
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
