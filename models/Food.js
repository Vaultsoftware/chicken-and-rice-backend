import mongoose from "mongoose"

const FoodSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    price: { type: Number, required: true },
    category: { type: String, default: "Main" }, // e.g. "main", "sides-drinks", "dessert"
    isAvailable: { type: Boolean, default: true },
    isPopular: { type: Boolean, default: false },
    image: { type: String },

    // ✅ Location fields
    state: { type: String }, // e.g. "Lagos"
    lgas: [{ type: String }], // e.g. ["Ikeja", "Surulere"]
  },
  { timestamps: true }
)

export default mongoose.model("Food", FoodSchema)
