// models/DrinkPop.js
import mongoose from "mongoose";

const drinkPopSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true }, // 💰 Price field
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("DrinkPop", drinkPopSchema);
