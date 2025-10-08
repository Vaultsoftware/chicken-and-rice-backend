// ================================
// backend/models/Order.js
// ================================
import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    items: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        // pack:{ type:Number, required :true}
      },
    ],

    orderType: {
      type: String,
      enum: ["online", "instore", "chowdeck"], // <-- added "chowdeck"
      default: "online",
    },

    customerName: { type: String },
    phone: { type: String },
    houseNumber: { type: String },
    street: { type: String },
    landmark: { type: String },

    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    paymentMode: {
      type: String,
      enum: ["cash", "card", "transfer"],
      default: "transfer",
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid"],
      default: "unpaid",
    },

    specialNotes: { type: String },

    status: {
      type: String,
      enum: [
        "pending",
        "assigned",
        "accepted",
        "in-transit",
        "delivered",
        "cancelled",
        "completed",
      ],
      default: "pending",
    },

    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deliveryman",
      default: null,
    },

    orderDate: { type: Date, default: Date.now },
    deliveryDate: { type: Date },
    deliveryTime: { type: Date },

    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [lng, lat]
        default: [3.3792, 6.5244], // Lagos fallback
      },
    },
  },
  { timestamps: true }
);

orderSchema.index({ location: "2dsphere" });

orderSchema.pre("save", function (next) {
  if (this.items && this.items.length > 0) {
    this.subtotal = this.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );
  }
  this.tax = this.tax || 0;
  this.deliveryFee = this.deliveryFee || 0;
  this.total = this.subtotal + this.tax + this.deliveryFee;
  next();
});

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
export default Order;
