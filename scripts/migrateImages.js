// scripts/migrateImages.js
import dotenv from "dotenv";
import mongoose from "mongoose";

// ✅ Load .env
dotenv.config();

// ✅ Grab MONGO_URI
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI is missing. Please set it in your .env file.");
  process.exit(1);
}

// ✅ Define Food schema (only what we need)
const foodSchema = new mongoose.Schema({
  name: String,
  image: String,
});

const Food = mongoose.model("Food", foodSchema);

async function migrate() {
  try {
    // ✅ Connect to DB
    await mongoose.connect(MONGO_URI, { dbName: "fastfooddb" });
    console.log("✅ Connected to MongoDB");

    // ✅ Fetch foods
    const foods = await Food.find();
    console.log(`🔍 Found ${foods.length} food items.`);

    // ✅ Update image URLs if not already pointing to uploads/
    for (let food of foods) {
      if (food.image && !food.image.startsWith("https://fastfolderbackend.fly.dev/uploads/")) {
        // Extract filename from old URL
        const filename = food.image.split("/").pop();

        // Build new uploads URL
        const newUrl = `https://fastfolderbackend.fly.dev/uploads/${filename}`;

        console.log(`🍔 Updating "${food.name}" -> ${newUrl}`);
        food.image = newUrl;
        await food.save();
      }
    }

    console.log("🎉 Migration complete!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

migrate();
