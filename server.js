// ============================================================================
// backend/server.js
// ============================================================================

import "dotenv/config";
process.env.TZ = process.env.TZ || process.env.INVENTORY_TZ || "Africa/Lagos";

import "./tools/express-log-paths.mjs";
import "./tools/route-guard.mjs";
import "./tools/ptr-global-patch.mjs";
import "./tools/route-debug.mjs";

import mongoose from "mongoose";
import cors from "cors";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import { upload } from "./middleware/upload.js";
import { initFirebase, putFile, statObject, getBucket } from "./lib/firebaseAdmin.js";

const { default: express } = await import("express");
const app = express();
app.set("trust proxy", 1);

// Build/version identifier (shows up in /__diag/version)
const GIT_SHA =
  process.env.FLY_IMAGE_REF ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.HEROKU_SLUG_COMMIT ||
  process.env.RENDER_GIT_COMMIT ||
  "local-dev";

// ---- Firebase init (awaited) ----
try {
  await initFirebase();
  const bucketName = (() => { try { return getBucket()?.name || null; } catch { return null; } })();
  console.log(`✅ Firebase ready (bucket=${bucketName}) [build=${GIT_SHA}]`);
} catch (e) {
  console.error("❌ Firebase init failed:", e?.message || e);
  process.exit(1);
}

// ---- Parsers ----
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- CORS ----
const allowedOrigins = [
  "https://chickenandrice.net",
  "https://www.chickenandrice.net",
  /\.chickenandrice\.net$/i,
  "https://chickenandrice.vercel.app",
  /\.vercel\.app$/i, // allow Vercel previews/custom subdomains
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
app.use(
  cors({
    origin(origin, cb) {
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

// ---- __dirname ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Helpers ----
function sanitizeName(original = "file.bin") {
  const ext = path.extname(original).toLowerCase() || ".bin";
  const base = path.basename(original, ext);
  const safe = (base || "file")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${Date.now()}-${safe}${ext}`;
}

// ---- Optional storage readiness guard (keeps errors obvious) ----
app.use((req, res, next) => {
  try {
    getBucket();
    return next();
  } catch {
    return res.status(503).json({ error: "storage not ready" });
  }
});

// ---- /uploads proxy → Firebase Storage ----
// RegExp avoids path-to-regexp issues; capture is in req.params[0]
app.get(/^\/uploads\/(.+)$/, async (req, res) => {
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

// ---- Health & Diagnostics ----
app.get("/healthz", (_req, res) => {
  let bucket = null;
  try {
    bucket = getBucket()?.name || null;
  } catch {}
  res.json({
    ok: !!(process.env.MONGO_URI && process.env.JWT_SECRET),
    mongoUriConfigured: !!process.env.MONGO_URI,
    jwtConfigured: !!process.env.JWT_SECRET,
    bucket,
  });
});

app.get("/__diag/ping", (_req, res) => {
  try {
    res.json({ ok: true, bucket: getBucket()?.name || null });
  } catch {
    res.json({ ok: false });
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

app.get("/__diag/version", (_req, res) => {
  let bucket = null;
  try {
    bucket = getBucket()?.name || null;
  } catch {}
  res.json({
    ok: true,
    build: GIT_SHA,
    bucket,
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    },
  });
});

// Check if a specific GCS key exists (useful when UI shows 404)
app.get("/__diag/gcs/head", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ error: "missing ?key=" });
    const info = await statObject(key);
    if (!info) return res.status(404).json({ ok: false, exists: false });
    res.json({ ok: true, exists: true, meta: info.meta });
  } catch (e) {
    console.error("⚠️ head error:", e?.message || e);
    res.status(500).json({ error: "failed" });
  }
});

// Upload test (raw file field name = "file")
app.post("/__diag/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });
    const filename = `diagnostics/${sanitizeName(req.file.originalname || "file.bin")}`;
    let buffer = req.file.buffer;
    if (!buffer && req.file.path) buffer = fs.readFileSync(req.file.path);
    await putFile({ filename, buffer, contentType: req.file.mimetype });
    return res.json({ saved: true, filename, url: `/uploads/${filename}` });
  } catch (e) {
    console.error("⚠️ diag upload failed:", e?.message || e);
    return res.status(500).json({ error: "upload failed" });
  }
});

// Echo exactly what Multer receives (field name "imageFile" like your forms)
app.post("/__diag/multipart", upload.single("imageFile"), async (req, res) => {
  res.json({
    fields: req.body || {},
    file: req.file
      ? {
          fieldname: req.file.fieldname,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          hasBuffer: !!req.file.buffer,
        }
      : null,
  });
});

// ---- Mongo ----
if (!process.env.MONGO_URI) console.error("❌ MONGO_URI is not set");
if (!process.env.JWT_SECRET) console.warn("⚠️ JWT_SECRET is not set");

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");
    try {
      const coll = mongoose.connection.db.collection("inventoryitems");
      const indexes = await coll.indexes();
      const isSlugSingleField = (idx) =>
        idx?.key &&
        Object.keys(idx.key).length === 1 &&
        Object.prototype.hasOwnProperty.call(idx.key, "slug");
      for (const idx of indexes) {
        if (idx.name === "_id_") continue;
        if (isSlugSingleField(idx) && idx.unique) continue;
        const keys = idx.key ? Object.keys(idx.key) : [];
        const referencesSkuOrName = keys.some((k) => /^(sku|name)/i.test(k));
        const nonUniqueSlugSingle = isSlugSingleField(idx) && !idx.unique;
        if (referencesSkuOrName || nonUniqueSlugSingle) {
          await coll.dropIndex(idx.name);
          console.log(
            `🧹 Dropped legacy index inventoryitems.${idx.name} (${JSON.stringify(
              idx.key
            )})`
          );
        }
      }
      const fresh = await coll.indexes();
      const hasUniqueSlug = fresh.some((i) => isSlugSingleField(i) && i.unique);
      if (!hasUniqueSlug) {
        await coll.createIndex({ slug: 1 }, { unique: true, name: "slug_1" });
        console.log("✅ Ensured unique index inventoryitems.slug_1");
      }
    } catch (e) {
      console.warn(
        "⚠️ Could not clean/ensure indexes on inventoryitems:",
        e?.message || e
      );
    }
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

// ---- Routers ----
const { default: foodRoutes } = await import("./routes/foodRoutes.js");
const { default: orderRoutes } = await import("./routes/orders.js");
const { default: deliverymanRoutes } = await import("./routes/deliverymanRoutes.js");
const { default: checkMealRoutes } = await import("./routes/checkMeal.js");
const { default: adminAuthRoutes } = await import("./routes/auth.js");
const { default: foodPopRoutes } = await import("./routes/foodPopRoutes.js");
const { default: drinkPopRoutes } = await import("./routes/drinkPopRoutes.js");
const { default: proteinPopRoutes } = await import("./routes/proteinPopRoutes.js");
const { default: emailRoutes } = await import("./routes/emailRoutes.js");
const { default: drinkRoutes } = await import("./routes/drinkRoutes.js");
const { default: inventoryRoutes } = await import("./routes/inventory.js");
const { default: uploadRoutes } = await import("./routes/uploadRoutes.js");
const { default: facebookRoutes} = await import("./routes/facebook.js");
// import facebookRoutes from './routes/facebook.js';

// ---- Root + protected ----
const appName = "Chicken & Rice API 🍚🍗";
app.get("/", (_req, res) => res.json({ message: `Welcome to ${appName}` }));

app.get("/api/protected", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    res.json({ message: "Protected route access granted", user: decoded });
  });
});

// ---- API routes ----
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
app.use("/api", uploadRoutes); // exposes POST /api/upload
app.use("/facebook", facebookRoutes); 

// ---- Error handler ----
app.use((err, _req, res, _next) => {
  console.error("⚠️ Server error:", err?.message || err);
  res.status(500).json({ error: "Something went wrong" });
});

// ---- Listen ----
const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
