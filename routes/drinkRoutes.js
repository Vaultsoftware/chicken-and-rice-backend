// routes/drinkRoutes.js
import express from "express";
import Drink from "../models/Drink.js";
import { upload } from "../middleware/upload.js";
import { putFile } from "../lib/firebaseAdmin.js";

const router = express.Router();

const sanitize = (name = "file.bin") => {
  const dot = name.lastIndexOf(".");
  const base = (dot === -1 ? name : name.slice(0, dot)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "file";
  const ext  = dot === -1 ? ".bin" : name.slice(dot).toLowerCase();
  return `${Date.now()}-${base}${ext}`;
};
const makeKey = (prefix, originalname) => `${prefix}/${sanitize(originalname || "file.bin")}`;

// Create drink
router.post("/", upload.single("imageFile"), async (req, res) => {
  try {
    const { name, price } = req.body;
    let imagePath;
    if (req.file?.buffer) {
      const key = makeKey("drinks", req.file.originalname);
      await putFile({ filename: key, buffer: req.file.buffer, contentType: req.file.mimetype });
      imagePath = `/uploads/${key}`;
    }

    const drink = new Drink({ name, price, image: imagePath });
    await drink.save();
    res.status(201).json(drink);
  } catch (err) {
    console.error("❌ POST /drinks failed:", err?.message || err);
    res.status(400).json({ error: err.message || "Failed to save drink" });
  }
});

// Get all drinks
router.get("/", async (_req, res) => {
  try {
    const drinks = await Drink.find().sort({ createdAt: -1 });
    res.json(drinks);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch drinks" });
  }
});

// Get single drink
router.get("/:id", async (req, res) => {
  try {
    const drink = await Drink.findById(req.params.id);
    if (!drink) return res.status(404).json({ error: "Drink not found" });
    res.json(drink);
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to fetch drink" });
  }
});

// Update drink
router.put("/:id", upload.single("imageFile"), async (req, res) => {
  try {
    const { name, price } = req.body;
    const updates = { name, price };

    if (req.file?.buffer) {
      const key = makeKey("drinks", req.file.originalname);
      await putFile({ filename: key, buffer: req.file.buffer, contentType: req.file.mimetype });
      updates.image = `/uploads/${key}`;
    }

    const drink = await Drink.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!drink) return res.status(404).json({ error: "Drink not found" });

    res.json(drink);
  } catch (err) {
    console.error("❌ PUT /drinks/:id failed:", err?.message || err);
    res.status(400).json({ error: err.message || "Failed to update drink" });
  }
});

// Delete drink
router.delete("/:id", async (req, res) => {
  try {
    const drink = await Drink.findByIdAndDelete(req.params.id);
    if (!drink) return res.status(404).json({ error: "Drink not found" });
    res.json({ message: "Drink deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message || "Failed to delete drink" });
  }
});

export default router;
