// models/Drink.js
import mongoose from "mongoose";

const drinkSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    image: { type: String }, // store file path (e.g. "/uploads/xxx.jpg")
  },
  { timestamps: true }
);

const Drink = mongoose.model("Drink", drinkSchema);
export default Drink;
