// backend/server.js
import "dotenv/config";

process.env.TZ = process.env.TZ || process.env.INVENTORY_TZ || "Africa/Lagos";

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import { upload, sanitizeName } from "./middleware/upload.js";
import { initFirebase, putFile, statObject, getBucket } from "./lib/firebaseAdmin.js";

// Routes
import foodRoutes from "./routes/foodRoutes.js";
import orderRoutes from "./routes/orders.js";
import deliverymanRoutes from "./routes/deliverymanRoutes.js";
import checkMealRoutes from "./routes/checkMeal.js";
import adminAuthRoutes from "./routes/auth.js";
import foodPopRoutes from "./routes/foodPopRoutes.js";
import drinkPopRoutes from "./routes/drinkPopRoutes.js";
import proteinPopRoutes from "./routes/proteinPopRoutes.js";
import emailRoutes from "./routes/emailRoutes.js";
import drinkRoutes from "./routes/drinkRoutes.js";
import inventoryRoutes from "./routes/inventory.js";

const app = express();
app.set("trust proxy", 1);

// ✅ Firebase init safety: don’t crash if secrets missing
try {
  const firebaseApp = initFirebase();
  if (firebaseApp) console.log("✅ Firebase initialized");
  else console.warn("⚠️ Firebase not initialized (missing credentials)");
} catch (e) {
  console.error("❌ Firebase init failed:", e?.message || e);
  // Don’t exit — continue running for /healthz visibility
}

// Body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ CORS
const allowedOrigins = [
  "https://chickenandrice.net",
  "https://www.chickenandrice.net",
  /\.chickenandrice\.net$/,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://chickenandrice.vercel.app",
];
app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true);
      if (
        allowedOrigins.includes(origin) ||
        allowedOrigins.some((o) => o instanceof RegExp && o.test(origin))
      ) {
        return cb(null, true);
      }
      console.error("❌ Blocked by CORS:", origin);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

// Static Firebase-backed uploads
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get("/uploads/*", async (req, res) => {
  try {
    const rel = req.params?.[0] || "";
    if (!rel) return res.status(404).end();

    const info = await statObject(rel);
    if (!info) return res.status(404).json({ error: "Not found" });

    const { file, meta } = info;
    if (meta?.contentType) res.setHeader("Content-Type", meta.contentType);
    res.setHeader(
      "Cache-Control",
      meta?.cacheControl || "public, max-age=31536000, immutable"
    );

    const stream = file.createReadStream();
    stream.on("error", (err) => {
      console.error("⚠️ GCS stream error:", err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: "stream failed" });
    });
    stream.pipe(res);
  } catch (e) {
    console.error("⚠️ /uploads error:", e?.message || e);
    if (!res.headersSent) res.status(500).json({ error: "failed" });
  }
});

// Health diagnostics
app.get("/healthz", (_req, res) => {
  const ok = Boolean(process.env.MONGO_URI) && Boolean(process.env.JWT_SECRET);
  const bucket = getBucket();
  res.json({
    ok,
    mongoUriConfigured: Boolean(process.env.MONGO_URI),
    jwtConfigured: Boolean(process.env.JWT_SECRET),
    bucket: bucket?.name || null,
  });
});

app.get("/__diag/ping", async (_req, res) => {
  try {
    const bucket = getBucket();
    res.json({ ok: true, bucket: bucket?.name || null });
  } catch {
    res.json({ ok: false });
  }
});

app.post("/__diag/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });
    const filename = sanitizeName(req.file.originalname || "file.bin");

    await putFile({
      filename,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
    });

    return res.json({
      saved: true,
      filename,
      url: `/uploads/${filename}`,
    });
  } catch (e) {
    console.error("⚠️ diag upload failed:", e?.message || e);
    return res.status(500).json({ error: "upload failed" });
  }
});

app.get("/__diag/time", (_req, res) => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  res.json({
    tz: process.env.TZ || "system-default",
    nowISO: now.toISOString(),
    startOfTodayISO: start.toISOString(),
  });
});

// MongoDB Connection (with retry)
if (!process.env.MONGO_URI) console.error("❌ MONGO_URI is not set");
if (!process.env.JWT_SECRET) console.warn("⚠️ JWT_SECRET is not set");

async function connectMongo(retries = 5, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      await mongoose.connect(process.env.MONGO_URI);
      console.log("✅ MongoDB connected");
      return;
    } catch (err) {
      console.error(`❌ MongoDB connection failed (${i + 1}/${retries}):`, err.message);
      if (i < retries - 1) await new Promise((r) => setTimeout(r, delay));
    }
  }
  console.error("🚨 MongoDB could not connect after retries; continuing app for diagnostics.");
}

connectMongo();

// Root
app.get("/", (_req, res) =>
  res.json({ message: "Welcome to Chicken & Rice API 🍚🍗" })
);

app.get("/api/protected", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    res.json({ message: "Protected route access granted", user: decoded });
  });
});

// Routes
app.use("/api/foods", foodRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/delivery", deliverymanRoutes);
app.use("/api/check-meal", checkMealRoutes);
app.use("/api/admin", adminAuthRoutes);
app.use("/api/foodpop", foodPopRoutes);
app.use("/api/drinkpop", drinkPopRoutes);
app.use("/api/proteinpop", proteinPopRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/drinks", drinkRoutes);
app.use("/api/inventory", inventoryRoutes);

// Error handler
app.use((err, _req, res, _next) => {
  console.error("⚠️ Server error:", err?.message || err);
  res.status(500).json({ error: "Something went wrong" });
});

// ✅ Ensure server keeps container alive
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
