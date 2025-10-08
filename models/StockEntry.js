// ================================
// backend/models/StockEntry.js
// ================================
import mongoose from "mongoose";

/**
 * Why: Append-only log of additions. Editing/deleting entries rewrites history cleanly.
 */
const stockEntrySchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "InventoryItem", required: true },
    quantity: { type: Number, required: true, min: 0 }, // grams or pieces
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

stockEntrySchema.index({ item: 1, createdAt: -1 });

const StockEntry = mongoose.models.StockEntry || mongoose.model("StockEntry", stockEntrySchema);
export default StockEntry;
