import mongoose from "mongoose";

const MealSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  state: { type: String, required: true },
  lgas: [{ type: String, required: true }],
});

export default mongoose.models.Meal || mongoose.model("Meal", MealSchema);
