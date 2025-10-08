// scripts/backfillIsPopular.js
import "dotenv/config";
import mongoose from "mongoose";
import Food from "../models/Food.js";

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const r = await Food.updateMany(
    { category: "Popular", $or: [{ isPopular: { $exists: false } }, { isPopular: false }] },
    { $set: { isPopular: true } }
  );
  console.log("Updated docs:", r.modifiedCount);
  await mongoose.disconnect();
  process.exit(0);
})();
