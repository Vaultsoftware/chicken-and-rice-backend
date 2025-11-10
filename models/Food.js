// backend/models/Food.js
import mongoose from "mongoose";

const FoodSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    price: { type: Number, required: true },
    category: { type: String, default: "Main" }, // e.g. "Main", "All Items", "Popular"
    isAvailable: { type: Boolean, default: true },
    isPopular: { type: Boolean, default: false },
    image: { type: String },

    // ✅ Location fields
    state: { type: String }, // e.g. "Lagos"
    lgas: [{ type: String }], // e.g. ["Ikeja", "Surulere"]

    // ✅ Bulk combo support
    isBulk: { type: Boolean, default: false },
    bulkInitialQty: { type: Number, default: 25, min: 1 },
  },
  { timestamps: true }
);

export default mongoose.models.Food || mongoose.model("Food", FoodSchema);
