// models/FoodPop.js
import mongoose from "mongoose";

const foodPopSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("FoodPop", foodPopSchema);



