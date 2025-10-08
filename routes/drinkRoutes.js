// routes/drinkRoutes.js
import express from "express";
import Drink from "../models/Drink.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

// Create drink
router.post("/", upload.single("imageFile"), async (req, res) => {
  try {
    const { name, price } = req.body;
    const drink = new Drink({
      name,
      price,
      image: req.file ? `/uploads/${req.file.filename}` : undefined,
    });
    await drink.save();
    res.status(201).json(drink);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get all drinks
router.get("/", async (_req, res) => {
  try {
    const drinks = await Drink.find().sort({ createdAt: -1 });
    res.json(drinks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single drink
router.get("/:id", async (req, res) => {
  try {
    const drink = await Drink.findById(req.params.id);
    if (!drink) return res.status(404).json({ error: "Drink not found" });
    res.json(drink);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update drink
router.put("/:id", upload.single("imageFile"), async (req, res) => {
  try {
    const { name, price } = req.body;
    const updates = { name, price };
    if (req.file) {
      updates.image = `/uploads/${req.file.filename}`;
    }

    const drink = await Drink.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!drink) return res.status(404).json({ error: "Drink not found" });

    res.json(drink);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete drink
router.delete("/:id", async (req, res) => {
  try {
    const drink = await Drink.findByIdAndDelete(req.params.id);
    if (!drink) return res.status(404).json({ error: "Drink not found" });
    res.json({ message: "Drink deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
