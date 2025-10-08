// scripts/cleanImages.js
import mongoose from "mongoose";
import dotenv from "dotenv";

// Load .env
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

// Food schema (minimal version)
const foodSchema = new mongoose.Schema({
  name: String,
  image: String,
});

const Food = mongoose.model("Food", foodSchema);

async function cleanImages() {
  try {
    await mongoose.connect(MONGO_URI);

    console.log("🍔 Connected to MongoDB");

    const foods = await Food.find({});
    let updatedCount = 0;

    for (const food of foods) {
      if (!food.image) continue;

      // ✅ Only keep images that start with your backend uploads path
      if (!food.image.startsWith("https://fastfolderbackend.fly.dev/uploads/")) {
        const fileName = food.image.split("/").pop(); // get last part
        const newUrl = `https://fastfolderbackend.fly.dev/uploads/${fileName}`;

        console.log(`🧹 Updating "${food.name}" -> ${newUrl}`);
        food.image = newUrl;
        await food.save();
        updatedCount++;
      }
    }

    console.log(`🎉 Cleanup complete! Updated ${updatedCount} images.`);
    mongoose.disconnect();
  } catch (err) {
    console.error("❌ Error during cleanup:", err);
    process.exit(1);
  }
}

cleanImages();
