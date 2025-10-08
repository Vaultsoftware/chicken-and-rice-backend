// backend/models/InventoryCatalog.js
import mongoose from "mongoose";

/**
 * Catalog of known inventory SKUs with kind/unit and aliases for name matching.
 * kind: "food" (grams) | "drink" (pieces) | "protein" (pieces)
 * unit: "gram" | "piece"
 */
const inventoryCatalogSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, trim: true, unique: true },
    kind: { type: String, enum: ["food", "drink", "protein"], required: true },
    unit: { type: String, enum: ["gram", "piece"], required: true },
    aliases: { type: [String], default: [] }, // lowercased
    note: { type: String, default: "" },
  },
  { timestamps: true }
);

inventoryCatalogSchema.index({ sku: 1 }, { unique: true });
inventoryCatalogSchema.index({ aliases: 1 });

const InventoryCatalog =
  mongoose.models.InventoryCatalog ||
  mongoose.model("InventoryCatalog", inventoryCatalogSchema);

export default InventoryCatalog;

