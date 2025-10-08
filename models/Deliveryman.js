// ================================
// backend/models/Deliveryman.js
// ================================
import mongoose from "mongoose";

const deliverymanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    address: {
      type: String,
      required: true, // ✅ must be provided at signup
    },
    dateOfBirth: {
      type: Date, // ✅ optional field
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: ["deliveryman", "admin"], // ✅ restrict roles
      default: "deliveryman",
    },
  },
  { timestamps: true }
);

// ✅ Prevent OverwriteModelError in dev
const Deliveryman =
  mongoose.models.Deliveryman || mongoose.model("Deliveryman", deliverymanSchema);

export default Deliveryman;
