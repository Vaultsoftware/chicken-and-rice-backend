// backend/seedAdmin.js
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import Admin from "./models/Admin.js";

async function main() {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error("MONGO_URI missing");

    await mongoose.connect(uri);
    console.log("✅ Connected to Mongo");

    const email = "chickenandriceltd@gmail.com";
    const password = "@Business25";

    const existing = await Admin.findOne({ email: email.toLowerCase() });
    if (existing) {
      console.log("⚠️ Admin already exists:", existing.email);
      process.exit(0);
    }

    const hashed = await bcrypt.hash(password, 10);
    const admin = await Admin.create({
      name: "Admin",
      email: email.toLowerCase(),
      password: hashed,
      role: "admin",
    });

    console.log("✅ Admin created:", admin.email);
    process.exit(0);
  } catch (e) {
    console.error("❌ Seed error:", e.message);
    process.exit(1);
  }
}
main();
