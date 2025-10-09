// backend/server.js
import "dotenv/config";

// TZ pin
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

/* ----------------------------------------------------------------------------
   Express v5 / path-to-regexp v6 compatibility shim for legacy wildcard routes.
   Fixes patterns like "/*", "/(.*)", "/(.*)?", "/(.*)+", "/(.*)*".
   We also dynamically import routers after installing the shim so it applies.
---------------------------------------------------------------------------- */
function compatifyPath(p) {
  if (typeof p !== "string") return p;

  let changed = false;
  let reCount = 0;
  let wcCount = 0;

  // 1) Convert ALL '/(.*)' segments, including modifiers (? + *) => '/:__v6_reN(.*)<mod>'
  //    Examples:
  //      '/(.*)'    -> '/:__v6_re0(.*)'
  //      '/(.*)?'   -> '/:__v6_re1(.*)?'
  //      '/foo/(.*)/bar' -> '/foo/:__v6_re2(.*)/bar'
  p = p.replace(/\/\(\.\*\)([+*?])?/g, (_m, mod = "") => {
    changed = true;
    return `/:__v6_re${reCount++}(.*)${mod}`;
  });

  // 2) Convert any '/*' segment(s) → '/:__v6_wcN(*)'
  p = p.replace(/\/\*(?=\/|$)/g, () => {
    changed = true;
    return `/:__v6_wc${wcCount++}(*)`;
  });

  // 3) Bare '*' or '/*' as the whole path
  if (p === "*" || p === "/*") {
    changed = true;
    p = "/:__v6_wc0(*)";
  }

  if (changed && process.env.DEBUG_WILDCARD === "1") {
    // Optional debug
    console.log("[compat route] →", p);
  }
  return p;
}

function wrapMethods(target) {
  const methods = ["get", "post", "put", "patch", "delete", "options", "head", "use", "all"];
  for (const m of methods) {
    const orig = target[m]?.bind(target);
    if (!orig) continue;
    target[m] = (first, ...rest) => {
      const patched = typeof first === "string" ? compatifyPath(first) : first;
      return orig(patched, ...rest);
    };
  }
}

const app = express();
app.set("trust proxy", 1);

// Patch app + Router BEFORE loading route modules
wrapMethods(app);
const _Router = express.Router;
express.Router = function (...args) {
  const r = _Router.apply(express, args);
  wrapMethods(r);
  return r;
};
/* ---------------------------------------------------------------------------- */

// Init Firebase (fail fast if creds missing)
try {
  initFirebase();
  console.log("✅ Firebase initialized");
} catch (e) {
  console.error("❌ Firebase init failed:", e?.message || e);
  process.exit(1);
}

// body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS
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

// __dirname (retained)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Firebase-backed /uploads — Express 5 safe wildcard.
 * Keeps existing URLs: GET /uploads/<filename or nested/path>
 */
app.get("/uploads/:path(*)", async (req, res) => {
  try {
    const rel = req.params?.path || "";
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

// Health/diagnostics
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

// In-memory upload → Firebase
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

// TZ diag
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

// Mongo
if (!process.env.MONGO_URI) console.error("❌ MONGO_URI is not set");
if (!process.env.JWT_SECRET) console.warn("⚠️ JWT_SECRET is not set");

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");

    // inventory index housekeeping (retained)
    try {
      const coll = mongoose.connection.db.collection("inventoryitems");
      const indexes = await coll.indexes();

      const isSlugSingleField = (idx) =>
        idx &&
        idx.key &&
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

// ---------- Dynamically import routers AFTER shim so patterns are compat ----------
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
// -------------------------------------------------------------------------------

// Root + protected
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

// API routes
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
