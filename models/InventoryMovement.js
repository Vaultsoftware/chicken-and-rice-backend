// backend/models/InventoryMovement.js
import mongoose from "mongoose";

const movementSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      // added "low_stock" for alert logging
      enum: ["create", "edit", "delete", "reset", "add", "edit_stock", "delete_stock", "low_stock"],
      required: true,
    },
    sku: { type: String, required: true },     // display name (from item.name)
    slug: { type: String, required: true },    // canonical slug
    unit: { type: String, enum: ["gram", "piece"], required: true },
    note: { type: String, default: "" },       // optional details (e.g. field changes or qty)
  },
  { timestamps: true }
);

movementSchema.index({ createdAt: -1 });

const InventoryMovement =
  mongoose.models.InventoryMovement || mongoose.model("InventoryMovement", movementSchema);
export default InventoryMovement;
