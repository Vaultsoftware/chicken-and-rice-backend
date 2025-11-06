// backend/models/InventoryItem.js
import mongoose from "mongoose";

const inventoryItemSchema = new mongoose.Schema(
  {
    // Display name/SKU as entered by you (e.g. "Fried Rice", "Coke")
    name: { type: String, required: true },

    // Canonical slug we match against orders
    // NOTE: leave uniqueness to the schema-level index below to avoid duplicate index warnings
    slug: { type: String, required: true },

    // 'food' | 'drink' | 'protein'
    kind: { type: String, enum: ["food", "drink", "protein"], required: true },

    // 'gram' | 'piece'
    unit: { type: String, enum: ["gram", "piece"], required: true },

    // Optional alias strings; we normalize them when matching
    aliases: { type: [String], default: [] },
  },
  { timestamps: true }
);

// Do NOT put an index on "name" (it caused duplicate-key errors earlier)
// Single source of truth for slug uniqueness:
inventoryItemSchema.index({ slug: 1 }, { unique: true });

const InventoryItem =
  mongoose.models.InventoryItem || mongoose.model("InventoryItem", inventoryItemSchema);

export default InventoryItem;
