// scripts/fix-upi-to-transfer.js
import "dotenv/config";
import mongoose from "mongoose";
import Order from "../models/Order.js";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const res = await Order.updateMany(
    { paymentMode: "upi" },
    { $set: { paymentMode: "transfer" } }
  );
  console.log("Updated orders:", res.modifiedCount);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
