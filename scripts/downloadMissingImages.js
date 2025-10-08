import mongoose from "mongoose";
import axios from "axios";
import fs from "fs";
import path from "path";
import Food from "../models/Food.js"; 
import dotenv from "dotenv";

dotenv.config();

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// ✅ fallback image inside uploads (make sure you have one like "fallback.jpg")
const FALLBACK_IMAGE = "https://fastfolderbackend.fly.dev/uploads/fallback.jpg";

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("🍔 Connected to MongoDB");

  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
  }

  const foods = await Food.find({});

  for (const food of foods) {
    let img = food.image;

    // ✅ Case 1: Already uploaded (skip)
    if (
      img &&
      (img.startsWith("http://localhost") ||
        img.startsWith("https://fastfolderbackend.fly.dev/uploads"))
    ) {
      console.log(`⏩ Skipping "${food.name}" -> already uploaded`);
      continue;
    }

    // ✅ Case 2: No image at all
    if (!img) {
      console.log(`⚠️ Missing image for "${food.name}" -> using fallback`);
      food.image = FALLBACK_IMAGE;
      await food.save();
      continue;
    }

    // ✅ Case 3: Try downloading external image
    try {
      console.log(`⬇️ Downloading "${food.name}" from ${img}`);

      const response = await axios.get(img, { responseType: "arraybuffer" });
      const ext = path.extname(new URL(img).pathname) || ".jpg";
      const fileName = `${Date.now()}-${food._id}${ext}`;
      const filePath = path.join(UPLOADS_DIR, fileName);

      fs.writeFileSync(filePath, response.data);

      const newUrl = `https://fastfolderbackend.fly.dev/uploads/${fileName}`;
      food.image = newUrl;
      await food.save();

      console.log(`✅ Updated "${food.name}" -> ${newUrl}`);
    } catch (err) {
      console.error(`❌ Failed for "${food.name}" (${img}) ->`, err.message);
      console.log(`➡️ Assigning fallback for "${food.name}"`);
      food.image = FALLBACK_IMAGE;
      await food.save();
    }
  }

  console.log("🎉 Migration finished!");
  await mongoose.disconnect();
}

run();
