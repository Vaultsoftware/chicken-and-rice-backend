// routes/proteinPopRoutes.js
import express from "express";
import ProteinPop from "../models/ProteinPop.js";

const router = express.Router();

// GET all proteins
router.get("/", async (req, res) => {
  try {
    const items = await ProteinPop.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create protein
router.post("/", async (req, res) => {
  try {
    const item = new ProteinPop({ 
      name: req.body.name, 
      price: req.body.price 
    });
    await item.save();
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT update protein
router.put("/:id", async (req, res) => {
  try {
    const item = await ProteinPop.findByIdAndUpdate(
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

// DELETE protein
router.delete("/:id", async (req, res) => {
  try {
    const item = await ProteinPop.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
