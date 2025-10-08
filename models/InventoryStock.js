// backend/models/InventoryStock.js
import mongoose from "mongoose";

const stockSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true },                 // display name (item.name)
    slug: { type: String, required: true, index: true },   // canonical slug
    unit: { type: String, enum: ["gram", "piece"], required: true },
    qty: { type: Number, required: true, min: 0 },
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

stockSchema.index({ createdAt: -1 });

const InventoryStock =
  mongoose.models.InventoryStock || mongoose.model("InventoryStock", stockSchema);
export default InventoryStock;
