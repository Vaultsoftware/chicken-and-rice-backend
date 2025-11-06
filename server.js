// File: backend/server.js
import "dotenv/config";
process.env.TZ = process.env.TZ || process.env.INVENTORY_TZ || "Africa/Lagos";

import mongoose from "mongoose";
import cors from "cors";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __require = createRequire(import.meta.url);

// --- 0) Load express early ---
const { default: express } = await import("express");

// -------------------- DIAG: log any suspicious raw '(' paths at registration --------------------
{
  const appProto = express.application;
  const routerProto = express.Router?.prototype;
  const METHODS = ["use","all","get","post","put","patch","delete","options","head"];

  const looksBad = (s) =>
    typeof s === "string" &&
    s.includes("(") &&
    !/:([A-Za-z0-9_]+)\(/.test(s); // allow :param( ... )

  function wrap(proto, name) {
    const orig = proto[name];
    if (typeof orig !== "function") return;
    proto[name] = function (...args) {
      for (const a of args) {
        if (typeof a === "string" && looksBad(a)) console.error("⛳ BAD PATH:", a);
        if (Array.isArray(a)) for (const x of a)
          if (typeof x === "string" && looksBad(x)) console.error("⛳ BAD PATH (array):", x);
      }
      return orig.apply(this, args);
    };
  }

  for (const p of [appProto, routerProto]) {
    if (!p) continue;
    for (const m of METHODS) wrap(p, m);
    const origRoute = p.route;
    if (typeof origRoute === "function") {
      p.route = function (pathArg, ...rest) {
        if (looksBad(pathArg)) console.error("⛳ BAD PATH (.route):", pathArg);
        return origRoute.call(this, pathArg, ...rest);
      };
    }
  }
}
// -------------------- END DIAG ---------------------------------------------------------------

// -------------------- COMPAT SHIM (robust) --------------------
(function installCompat() {
  const DEBUG = process.env.COMPAT_ROUTE_DEBUG === "1";

  function compatifyPath(p) {
    if (typeof p !== "string") return p;
    const original = p;
    let splat = 0, opt = 0, alt = 0;

    // 1) '/(.*)' (+ modifiers)
    p = p.replace(/\/\(\.\*\)([+*?])?/g, (_m, mod = "") => `/:splat${splat++}(.*)${mod}`);

    // 2) '/x/*' → '/x/:splat*'
    p = p.replace(/\/\*(?=\/|$)/g, () => `/:splat${splat++}*`);

    // 3) bare '*' or '/*'
    if (p === "*" || p === "/*") p = "/:splat0(.*)";

    // 4) '(/seg)?' → '/:opt(seg)?'
    p = p.replace(/\/\(([^)\/]+)\)\?/g, (_m, seg) => `/:opt${opt++}(${seg})?`);

    // 5) '/(a|b)' → '/:alt(a|b)'
    p = p.replace(/\/\(([^)]+?\|[^)]+?)\)/g, (_m, alts) => `/:alt${alt++}(${alts})`);

    // 6) Guard: escape '(' / ')' not part of ':param('...')'
    p = p.replace(/(\()|(\))/g, (m, lpar, rpar, idx) => {
      if (lpar) {
        const before = p.slice(Math.max(0, idx - 20), idx);
        if (!/:\w*$/.test(before)) return "\\(";
      }
      if (rpar) {
        const before = p.slice(0, idx);
        const opened = (before.match(/:\w+\(/g) || []).length;
        const closed = (before.match(/\)/g) || []).length;
        if (opened <= closed) return "\\)";
      }
      return m;
    });

    if (DEBUG && p !== original) console.log(`🔧 compat route: "${original}" → "${p}"`);
    return p;
  }

  function rewriteLeadingPaths(args) {
    if (!args || !args.length) return args;
    const out = [];
    let i = 0;
    while (i < args.length) {
      const a = args[i];
      const isFn = typeof a === "function";
      const isPathLike =
        typeof a === "string" ||
        a instanceof RegExp ||
        (Array.isArray(a) && a.every(x => typeof x === "string" || x instanceof RegExp));
      if (!isPathLike || isFn) break;

      if (typeof a === "string") out.push(compatifyPath(a));
      else if (Array.isArray(a)) out.push(a.map(x => (typeof x === "string" ? compatifyPath(x) : x)));
      else out.push(a);
      i++;
    }
    for (; i < args.length; i++) out.push(args[i]);
    return out;
  }

  const METHODS = [
    "all","get","post","put","patch","delete","options","head",
    "copy","lock","mkcol","move","purge","propfind","proppatch","search","trace",
    "unlock","report","mkactivity","checkout","merge","m-search","notify",
    "subscribe","unsubscribe","link","unlink"
  ];

  function patchProto(proto) {
    if (!proto) return;
    if (typeof proto.use === "function") {
      const origUse = proto.use;
      proto.use = function patchedUse(...args) { return origUse.apply(this, rewriteLeadingPaths(args)); };
    }
    for (const m of METHODS) {
      if (typeof proto[m] === "function") {
        const orig = proto[m];
        proto[m] = function patchedMethod(...args) { return orig.apply(this, rewriteLeadingPaths(args)); };
      }
    }
    if (typeof proto.route === "function") {
      const origRoute = proto.route;
      proto.route = function patchedRoute(pathArg, ...rest) {
        const p = typeof pathArg === "string" ? compatifyPath(pathArg) : pathArg;
        return origRoute.apply(this, [p, ...rest]);
      };
    }
  }

  patchProto(express.application);
  const OrigRouterFactory = express.Router;
  if (OrigRouterFactory && OrigRouterFactory.prototype) patchProto(OrigRouterFactory.prototype);
  if (typeof OrigRouterFactory === "function") {
    express.Router = function patchedRouter(...args) {
      const r = OrigRouterFactory.apply(this, args);
      patchProto(r);
      return r;
    };
  }

  // Last-mile: wrap router Layer ctor
  let layerPath;
  try { layerPath = __require.resolve("router/lib/layer.js"); }
  catch { try { layerPath = __require.resolve("express/lib/router/layer.js"); } catch { layerPath = null; } }

  if (layerPath) {
    __require(layerPath);
    const cache = __require.cache[layerPath];
    const OrigLayer = cache.exports;

    function PatchedLayer(pathArg, options, fn) {
      const raw = pathArg;
      const safe = typeof raw === "string" ? compatifyPath(raw) : raw;
      try {
        return new OrigLayer(safe, options, fn);
      } catch (e) {
        console.error("⛔ Router Layer compile failed");
        console.error("   raw:  ", raw);
        console.error("   safe: ", safe);
        throw e;
      }
    }
    PatchedLayer.prototype = OrigLayer.prototype;
    Object.setPrototypeOf(PatchedLayer, OrigLayer);
    Object.defineProperties(PatchedLayer, Object.getOwnPropertyDescriptors(OrigLayer));

    cache.exports = function LayerProxy(pathArg, options, fn) {
      return PatchedLayer.call(this, pathArg, options, fn);
    };
    cache.exports.prototype = PatchedLayer.prototype;

    if (DEBUG) console.log("🔧 Installed router Layer safety wrapper");
  } else if (DEBUG) {
    console.log("ℹ️ Layer module not found; API patch only");
  }
})();
// ------------------ END COMPAT SHIM ------------------

import { upload } from "./middleware/upload.js";
import { initFirebase, putFile, statObject, getBucket } from "./lib/firebaseAdmin.js";

const app = express();
app.set("trust proxy", 1);

// Firebase
try {
  initFirebase();
  console.log("✅ Firebase initialized");
} catch (e) {
  console.error("❌ Firebase init failed:", e?.message || e);
  process.exit(1);
}

// Parsers
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS
const allowedOrigins = [
  "https://chickenandrice.net",
  "https://www.chickenandrice.net",
  /\.chickenandrice\.net$/i,
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://chickenandrice.vercel.app",
];
app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin) || allowedOrigins.some(o => o instanceof RegExp && o.test(origin))) {
        return cb(null, true);
      }
      console.error("❌ Blocked by CORS:", origin);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
    credentials: true,
  })
);

// __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helpers
function sanitizeName(original = "file.bin") {
  const ext = path.extname(original).toLowerCase();
  const base = path.basename(original, ext);
  const safe = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${Date.now()}-${safe}${ext || ".bin"}`;
}

// Upload proxy
app.get("/uploads/:path(.*)", async (req, res) => {
  try {
    const rel = req.params?.path || "";
    if (!rel) return res.status(404).end();

    const info = await statObject(rel);
    if (!info) return res.status(404).json({ error: "Not found" });

    const { file, meta } = info;
    if (meta?.contentType) res.setHeader("Content-Type", meta.contentType);
    res.setHeader("Cache-Control", meta?.cacheControl || "public, max-age=31536000, immutable");

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

// Health
app.get("/healthz", (_req, res) => {
  const ok = Boolean(process.env.MONGO_URI) && Boolean(process.env.JWT_SECRET);
  const bucket = getBucket();
  res.json({ ok, mongoUriConfigured: !!process.env.MONGO_URI, jwtConfigured: !!process.env.JWT_SECRET, bucket: bucket?.name || null });
});

app.get("/__diag/ping", (_req, res) => {
  try { res.json({ ok: true, bucket: getBucket()?.name || null }); }
  catch { res.json({ ok: false }); }
});

app.post("/__diag/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });
    const filename = sanitizeName(req.file.originalname || "file.bin");
    let buffer = req.file.buffer;
    if (!buffer && req.file.path) buffer = fs.readFileSync(req.file.path);
    await putFile({ filename, buffer, contentType: req.file.mimetype });
    return res.json({ saved: true, filename, url: `/uploads/${filename}` });
  } catch (e) {
    console.error("⚠️ diag upload failed:", e?.message || e);
    return res.status(500).json({ error: "upload failed" });
  }
});

app.get("/__diag/time", (_req, res) => {
  const now = new Date();
  const start = new Date(now); start.setHours(0,0,0,0);
  res.json({ tz: process.env.TZ || "system-default", nowISO: now.toISOString(), startOfTodayISO: start.toISOString() });
});

// Mongo
if (!process.env.MONGO_URI) console.error("❌ MONGO_URI is not set");
if (!process.env.JWT_SECRET) console.warn("⚠️ JWT_SECRET is not set");

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");
    try {
      const coll = mongoose.connection.db.collection("inventoryitems");
      const indexes = await coll.indexes();
      const isSlugSingleField = (idx) => idx?.key && Object.keys(idx.key).length === 1 && Object.prototype.hasOwnProperty.call(idx.key, "slug");
      for (const idx of indexes) {
        if (idx.name === "_id_") continue;
        if (isSlugSingleField(idx) && idx.unique) continue;
        const keys = idx.key ? Object.keys(idx.key) : [];
        const referencesSkuOrName = keys.some((k) => /^(sku|name)/i.test(k));
        const nonUniqueSlugSingle = isSlugSingleField(idx) && !idx.unique;
        if (referencesSkuOrName || nonUniqueSlugSingle) {
          await coll.dropIndex(idx.name);
          console.log(`🧹 Dropped legacy index inventoryitems.${idx.name} (${JSON.stringify(idx.key)})`);
        }
      }
      const fresh = await coll.indexes();
      const hasUniqueSlug = fresh.some((i) => isSlugSingleField(i) && i.unique);
      if (!hasUniqueSlug) {
        await coll.createIndex({ slug: 1 }, { unique: true, name: "slug_1" });
        console.log("✅ Ensured unique index inventoryitems.slug_1");
      }
    } catch (e) {
      console.warn("⚠️ Could not clean/ensure indexes on inventoryitems:", e?.message || e);
    }
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

// Routers
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

// Root + protected
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
