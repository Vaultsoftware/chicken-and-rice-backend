// routes/foods.js
import express from "express";
import Food from "../models/Food.js";

const router = express.Router();

// Get all foods
router.get("/", async (req, res) => {
  try {
    const foods = await Food.find();
    res.json(foods);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// Add new food
router.post("/", async (req, res) => {
  try {
    const newFood = new Food(req.body);
    const saved = await newFood.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: "Invalid food data" });
  }
});

export default router;
