// routes/drinkPopRoutes.js
import express from "express";
import DrinkPop from "../models/DrinkPop.js";

const router = express.Router();

// GET all drinks
router.get("/", async (req, res) => {
  try {
    const items = await DrinkPop.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create drink
router.post("/", async (req, res) => {
  try {
    const item = new DrinkPop({ 
      name: req.body.name, 
      price: req.body.price 
    });
    await item.save();
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update drink
router.put("/:id", async (req, res) => {
  try {
    const item = await DrinkPop.findByIdAndUpdate(
      req.params.id,
      { name: req.body.name, price: req.body.price },
      { new: true }
    );
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE drink
router.delete("/:id", async (req, res) => {
  try {
    const item = await DrinkPop.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
