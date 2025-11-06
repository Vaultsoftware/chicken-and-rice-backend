// ============================================================================
// backend/routes/drinkRoutes.js
// Writes image to Firebase Storage; stores path "/uploads/drinks/<key>"
// ============================================================================
import express from "express";
import Drink from "../models/Drink.js";
import { upload } from "../middleware/upload.js";
import { saveToStorage, toNum } from "../lib/media.js";

const router = express.Router();

// Create drink
router.post("/", upload.single("imageFile"), async (req, res) => {
  try {
    const { name, price } = req.body;
    if (!name || price == null) return res.status(400).json({ error: "name and price are required" });

    let imagePath = undefined;
    if (req.file?.buffer) {
      const saved = await saveToStorage({
        buffer: req.file.buffer,
        originalname: req.file.originalname || "image.bin",
        mimetype: req.file.mimetype,
        prefix: "drinks",
      });
      imagePath = saved.path;
    }

    const drink = await Drink.create({ name, price: toNum(price, 0), image: imagePath });
    res.status(201).json(drink);
  } catch (err) {
    res.status(400).json({ error: err.message || "Failed to create drink" });
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
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (price !== undefined) updates.price = toNum(price);

    if (req.file?.buffer) {
      const saved = await saveToStorage({
        buffer: req.file.buffer,
        originalname: req.file.originalname || "image.bin",
        mimetype: req.file.mimetype,
        prefix: "drinks",
      });
      updates.image = saved.path;
    }

    const drink = await Drink.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!drink) return res.status(404).json({ error: "Drink not found" });

    res.json(drink);
  } catch (err) {
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
