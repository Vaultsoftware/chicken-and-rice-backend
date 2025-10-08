import express from "express"
import Food from "../models/Food.js"

const router = express.Router()

// Check if a meal is available in a given state/LGA
router.get("/:id", async (req, res) => {
  try {
    const { state, lga } = req.query
    const { id } = req.params

    if (!state || !lga) {
      return res.status(400).json({ error: "State and LGA are required" })
    }

    // Get the meal user is checking
    const meal = await Food.findById(id)
    if (!meal) {
      return res.status(404).json({ error: "Meal not found" })
    }

    // Check if it's available
    const isAvailable =
      meal.state === state && meal.lgas.includes(lga) && meal.isAvailable

    if (isAvailable) {
      return res.json({ available: true, meal, alternatives: [] })
    }

    // Otherwise, suggest other meals in that location
    const alternatives = await Food.find({
      state,
      lgas: { $in: [lga] }, // ✅ make sure it checks inside array
      isAvailable: true,
      _id: { $ne: id }, // exclude the current meal
    })

    return res.json({ available: false, meal, alternatives })
  } catch (err) {
    console.error("Check meal error:", err)
    res.status(500).json({ error: "Server error checking meal availability" })
  }
})

export default router
