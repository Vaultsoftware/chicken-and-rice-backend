// FILE: backend/routes/inventory.js
import express from "express";
import InventoryItem from "../models/InventoryItem.js";
import InventoryMovement from "../models/InventoryMovement.js";
import InventoryStock from "../models/InventoryStock.js";
import Order from "../models/Order.js";
import {
  normalizeSlug,
  baseFoodSlug,
  gramsForFoodName,
  inferKindUnit,
} from "../utils/inventoryName.js";
import { sendEmail } from "../utils/mailer.js";

const router = express.Router();

// --- helper: alias map (aliasSlug -> canonical item.slug)
async function buildAliasMap() {
  const items = await InventoryItem.find();
  const aliasToSlug = new Map(); // alias => slug
  const bySlug = new Map(); // slug => item
  for (const it of items) {
    bySlug.set(it.slug, it);
    aliasToSlug.set(it.slug, it.slug);
    for (const a of it.aliases || []) {
      const as = normalizeSlug(a);
      if (as) aliasToSlug.set(as, it.slug);
    }
    // foods: base (without "extra"/"half") points to same slug
    if (it.kind === "food") aliasToSlug.set(baseFoodSlug(it.name), it.slug);
  }
  return { items, aliasToSlug, bySlug };
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// -------------------- ITEMS --------------------

// list items (used by UI to populate selects)
router.get("/items", async (_req, res) => {
  try {
    const items = await InventoryItem.find().sort({ kind: 1, name: 1 }).lean();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to list items" });
  }
});

// create or upsert item; optional initialQty creates a stock entry for today
router.post("/items", async (req, res) => {
  try {
    const { sku, kind, unit, initialQty } = req.body || {};
    if (!sku || !kind || !unit) {
      return res.status(400).json({ error: "sku, kind, unit are required" });
    }
    const slug = normalizeSlug(sku);
    const doc = await InventoryItem.findOneAndUpdate(
      { slug },
      { $set: { name: sku, slug, kind, unit, aliases: [] } },
      { new: true, upsert: true }
    );

    // Log only when truly created (avoid noise on plain upserts)
    try {
      const existed = await InventoryMovement.exists({ slug: doc.slug, type: "create" });
      if (!existed) {
        await InventoryMovement.create({
          type: "create",
          sku: doc.name,
          slug: doc.slug,
          unit: doc.unit,
          note: "",
        });
      }
    } catch {}

    // optional same-day initial stock
    const q = Number(initialQty || 0);
    if (q > 0) {
      await InventoryStock.create({
        sku: doc.name,
        slug: doc.slug,
        unit: doc.unit,
        qty: q,
        note: "Initial stock",
      });
    }

    res.json(doc);
  } catch (e) {
    if (String(e?.code) === "11000") return res.status(409).json({ error: "Item already exists." });
    res.status(500).json({ error: e.message || "Failed to save item" });
  }
});

// edit item (no alias editing here; UI removed aliases)
router.patch("/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const doc = await InventoryItem.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    const before = { name: doc.name, kind: doc.kind, unit: doc.unit };

    if (body.name && body.name !== doc.name) {
      const newSlug = normalizeSlug(body.name);
      if (newSlug !== doc.slug) {
        const exists = await InventoryItem.findOne({ slug: newSlug });
        if (exists) return res.status(409).json({ error: "Another item with this name already exists." });
        // also move existing stock over to the new slug
        await InventoryStock.updateMany({ slug: doc.slug }, { $set: { slug: newSlug, sku: body.name } });
        doc.slug = newSlug;
      }
      doc.name = body.name;
    }

    if (body.kind) doc.kind = body.kind;
    if (body.unit) doc.unit = body.unit;

    await doc.save();

    const after = { name: doc.name, kind: doc.kind, unit: doc.unit };
    const note = `Edited: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`;

    await InventoryMovement.create({
      type: "edit",
      sku: doc.name,
      slug: doc.slug,
      unit: doc.unit,
      note,
    });

    res.json(doc);
  } catch (e) {
    if (String(e?.code) === "11000") return res.status(409).json({ error: "Duplicate after rename." });
    res.status(500).json({ error: e.message || "Failed to edit item" });
  }
});

// delete item + its stock entries (safe for today-only views)
router.delete("/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await InventoryItem.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    await InventoryItem.deleteOne({ _id: id });
    await InventoryStock.deleteMany({ slug: doc.slug }); // remove its stock entries

    await InventoryMovement.create({
      type: "delete",
      sku: doc.name,
      slug: doc.slug,
      unit: doc.unit,
      note: "",
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to delete item" });
  }
});

// -------------------- STOCK (today-only UI views) --------------------

// list today's stock entries
router.get("/stock", async (_req, res) => {
  try {
    const start = startOfToday();
    const entries = await InventoryStock.find({ createdAt: { $gte: start } })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ entries });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to list stock" });
  }
});

// --- robust string normalizers used by the resolver ---
function looseKey(s = "") {
  return String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s\-_]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
function maybeBase(s = "") {
  return baseFoodSlug(s);
}

// helper to resolve item using itemId | slug | sku (with “base food” and fuzzy matching)
async function resolveItem({ itemId, slug, sku }) {
  const { items, aliasToSlug, bySlug } = await buildAliasMap();

  // 1) Direct by itemId
  if (itemId) {
    const doc = await InventoryItem.findById(itemId);
    if (doc) return doc;
  }

  // 2) Try slug/sku candidates -> alias/base -> bySlug
  const rawCandidates = [];
  if (slug) rawCandidates.push(String(slug));
  if (sku) rawCandidates.push(String(sku));

  const normCandidates = [];
  for (const raw of rawCandidates) {
    normCandidates.push(normalizeSlug(raw));
    normCandidates.push(normalizeSlug(maybeBase(raw)));
    normCandidates.push(looseKey(raw));
  }

  for (const c of normCandidates) {
    const canonical = aliasToSlug.get(c) || aliasToSlug.get(maybeBase(c)) || c;
    const it = bySlug.get(canonical);
    if (it) return it;
  }

  // 3) Fallback: loose equality map (case/space insensitive)
  const byLoose = new Map();
  for (const it of items) {
    byLoose.set(looseKey(it.name), it);
    byLoose.set(looseKey(it.slug), it);
    if (it.kind === "food") byLoose.set(looseKey(maybeBase(it.name)), it);
  }
  for (const c of rawCandidates) {
    const lk = looseKey(c);
    const baseLk = looseKey(maybeBase(c));
    if (byLoose.has(lk)) return byLoose.get(lk);
    if (byLoose.has(baseLk)) return byLoose.get(baseLk);
  }

  // 4) Last resort: partial contains
  for (const c of rawCandidates) {
    const lk = looseKey(c);
    for (const it of items) {
      const nameKey = looseKey(it.name);
      const slugKey = looseKey(it.slug);
      if (nameKey.includes(lk) || lk.includes(nameKey) || slugKey.includes(lk) || lk.includes(slugKey)) {
        return it;
      }
    }
  }

  return null;
}

// Add/Restock quantity for an item
router.post("/stock", async (req, res) => {
  try {
    const { itemId, slug, sku, qty, note = "", kind: kindIn, unit: unitIn } = req.body || {};
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: "Positive qty is required" });
    }

    // 1) Try to resolve an existing item first
    let item = await resolveItem({ itemId, slug, sku });

    // 2) If not found but a name (sku) is given, auto-create a base item safely
    if (!item && sku) {
      const typed = String(sku).trim();
      const slugNorm = normalizeSlug(typed);
      const baseSlug = normalizeSlug(maybeBase(typed));

      // Prefer existing base item if present
      item = (await InventoryItem.findOne({ slug: baseSlug })) || (await InventoryItem.findOne({ slug: slugNorm }));

      if (!item) {
        const inferred = inferKindUnit(typed); // e.g. food/gram ; moimoi → food/piece; chicken → protein/piece
        const kind = kindIn || inferred.kind;
        const unit = unitIn || inferred.unit;

        const createName =
          baseSlug !== slugNorm ? String(typed).replace(/(?:extra|half)/gi, "").trim() || typed : typed;

        item = await InventoryItem.create({
          name: createName,
          slug: baseSlug,
          kind,
          unit,
          aliases: [],
        });

        try {
          await InventoryMovement.create({
            type: "create",
            sku: item.name,
            slug: item.slug,
            unit: item.unit,
            note: "",
          });
        } catch {}
      }
    }

    if (!item) {
      return res.status(404).json({ error: "Item not found. Create it first." });
    }

    // 3) Append today's stock entry
    const doc = await InventoryStock.create({
      sku: item.name,
      slug: item.slug,
      unit: item.unit,
      qty: n,
      note: note || "",
    });

    // Do NOT create a movement here
    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to add stock" });
  }
});

// edit a stock entry (qty or note)
router.patch("/stock/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const doc = await InventoryStock.findById(id);
    if (!doc) return res.status(404).json({ error: "Not found" });

    const before = { qty: doc.qty, note: doc.note };

    if (body.qty != null) {
      const n = Number(body.qty);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "Invalid qty" });
      doc.qty = n;
    }
    if (typeof body.note === "string") doc.note = body.note;

    await doc.save();

    // Optional audit entry for stock edits
    try {
      await InventoryMovement.create({
        type: "edit_stock",
        sku: doc.sku,
        slug: doc.slug,
        unit: doc.unit,
        note: `edit qty:${before.qty}->${doc.qty}${
          before.note !== doc.note ? `; note:${before.note || ""}->${doc.note || ""}` : ""
        }`,
      });
    } catch {}

    res.json(doc);
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to edit stock entry" });
  }
});

// delete a stock entry
router.delete("/stock/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await InventoryStock.findById(id);
    await InventoryStock.deleteOne({ _id: id });

    // Optional audit entry
    try {
      if (doc) {
        await InventoryMovement.create({
          type: "delete_stock",
          sku: doc.sku,
          slug: doc.slug,
          unit: doc.unit,
          note: `deleted +${doc.qty} ${doc.unit}${doc.note ? ` — ${doc.note}` : ""}`,
        });
      }
    } catch {}

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to delete stock entry" });
  }
});

// -------------------- MOVEMENTS (today only) --------------------
router.get("/movements", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const start = startOfToday();

    // System movements + stock edit/delete audit entries
    const sysMoves = await InventoryMovement.find({
      createdAt: { $gte: start },
      type: { $in: ["create", "edit", "delete", "edit_stock", "delete_stock"] },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Also include today's stock entries as "add"
    const stockToday = await InventoryStock.find({ createdAt: { $gte: start } })
      .sort({ createdAt: -1 })
      .lean();

    const stockAsMoves = stockToday.map((s) => ({
      _id: `stock-${s._id}`,
      type: "add",
      sku: s.sku,
      slug: s.slug,
      unit: s.unit,
      note: `+${s.qty} ${s.unit}${s.note ? ` — ${s.note}` : ""}`,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    const all = [...sysMoves, ...stockAsMoves]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);

    res.json({ items: all });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to fetch movements" });
  }
});

// -------------------- SUMMARY (today only; ALL orders) --------------------
router.get("/summary", async (_req, res) => {
  try {
    const start = startOfToday();
    const { items, aliasToSlug, bySlug } = await buildAliasMap();

    // 1) Added today
    const stock = await InventoryStock.find({ createdAt: { $gte: start } }).lean();
    const addedGram = new Map(); // slug -> grams added
    const addedPiece = new Map(); // slug -> pieces added
    for (const s of stock) {
      if (s.unit === "gram") {
        addedGram.set(s.slug, (addedGram.get(s.slug) || 0) + Number(s.qty || 0));
      } else {
        addedPiece.set(s.slug, (addedPiece.get(s.slug) || 0) + Number(s.qty || 0));
      }
    }

    // 2) Used today — include ALL order sources (removed orderType filter)
    const usedGram = new Map();
    const usedPiece = new Map();
    const extraUsedDisplay = new Map(); // extraSlug -> grams used (display only)

    const orders = await Order.find({
      createdAt: { $gte: start },
    }).select({ items: 1 });

    for (const o of orders) {
      for (const li of Array.isArray(o.items) ? o.items : []) {
        const qty = Number(li?.quantity ?? 0) || 0;
        if (!qty) continue;

        const raw = String(li?.name || "");
        const sl = normalizeSlug(raw);
        const base = baseFoodSlug(raw);
        const canonical = aliasToSlug.get(sl) || aliasToSlug.get(base) || sl;

        // prefer configured item, else fallback
        const meta = bySlug.get(canonical);
        const unit = meta?.unit || inferKindUnit(raw).unit;

        if (unit === "gram") {
          const grams = gramsForFoodName(raw) * qty; // 350g per plate; 175g if 'extra'/'half'
          // count towards base (deduct from stock)
          usedGram.set(canonical, (usedGram.get(canonical) || 0) + grams);

          // if this looks like an “extra/half”, also record a display row (no added/remaining)
          if (/(extra|half)/.test(sl)) {
            extraUsedDisplay.set(sl, (extraUsedDisplay.get(sl) || 0) + grams);
          }
        } else {
          usedPiece.set(canonical, (usedPiece.get(canonical) || 0) + qty);
        }
      }
    }

    // 3) Build rows by category (food/drink/protein). Some food rows can be in pieces.
    const foodRows = [];
    const drinkRows = [];
    const proteinRows = [];

    const pushRow = (arr, { slug, name, unit, added, used, kind }) => {
      const remaining = Math.max(0, Number(added || 0) - Number(used || 0));
      arr.push({
        _id: bySlug.get(slug)?._id || null,
        sku: name,
        slug,
        unit,
        added: Number(added || 0),
        used: Number(used || 0),
        remaining,
        kind: kind || bySlug.get(slug)?.kind || inferKindUnit(name).kind, // include kind for UI
      });
    };

    // Configured items first
    for (const it of items) {
      const slug = it.slug;
      const unit = it.unit;
      const kind = it.kind;

      const added = unit === "gram" ? addedGram.get(slug) || 0 : addedPiece.get(slug) || 0;
      const used = unit === "gram" ? usedGram.get(slug) || 0 : usedPiece.get(slug) || 0;

      const row = { slug, name: it.name, unit, added, used, kind };

      if (kind === "food") pushRow(foodRows, row);
      else if (kind === "drink") pushRow(drinkRows, row);
      else pushRow(proteinRows, row);

      // clear so leftovers below will be truly unknowns
      addedGram.delete(slug);
      addedPiece.delete(slug);
      usedGram.delete(slug);
      usedPiece.delete(slug);
    }

    // Any leftovers (used/added for items not configured) — heuristic classification
    for (const [slug, grams] of usedGram.entries()) {
      const inf = inferKindUnit(slug);
      if (inf.kind === "food")
        pushRow(foodRows, { slug, name: slug, unit: "gram", added: 0, used: grams, kind: "food" });
      else if (inf.kind === "drink")
        pushRow(drinkRows, { slug, name: slug, unit: "piece", added: 0, used: 0, kind: "drink" });
      else pushRow(proteinRows, { slug, name: slug, unit: "piece", added: 0, used: 0, kind: "protein" });
    }
    for (const [slug, pcs] of usedPiece.entries()) {
      const inf = inferKindUnit(slug);
      if (inf.kind === "food")
        pushRow(foodRows, { slug, name: slug, unit: "piece", added: 0, used: pcs, kind: "food" });
      else if (inf.kind === "drink")
        pushRow(drinkRows, { slug, name: slug, unit: "piece", added: 0, used: pcs, kind: "drink" });
      else pushRow(proteinRows, { slug, name: slug, unit: "piece", added: 0, used: pcs, kind: "protein" });
    }

    // Show “extra/half” informational rows (used-only, no added/remaining)
    for (const [extraSlug, grams] of extraUsedDisplay.entries()) {
      foodRows.push({
        _id: null,
        sku: extraSlug,
        slug: extraSlug,
        unit: "gram",
        added: 0,
        used: grams,
        remaining: 0,
        kind: "food",
        _extra: true, // client can choose to dim if desired
      });
    }

    // ---------- LOW STOCK EMAIL ALERTS (once per item per day) ----------
    try {
      const alerts = [];

      // helper: check once per day using movements
      const sentToday = async (slug) => {
        return !!(await InventoryMovement.exists({
          type: "low_stock",
          slug,
          createdAt: { $gte: start },
        }));
      };

      const enqueueAlert = async (row, thresholdLabel) => {
        // send only for configured items (have _id) to avoid noise
        if (!row?._id) return;
        if (await sentToday(row.slug)) return;

        const remainingStr =
          row.unit === "gram"
            ? `${Math.round(row.remaining)} g`
            : `${Math.round(row.remaining)} pcs`;

        const subject = `Low Stock: ${row.sku} – ${remainingStr} left (today)`;
        const html = `
          <div style="font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;line-height:1.5;color:#111">
            <h2 style="margin:0 0 8px">⚠️ Low Stock Alert</h2>
            <p style="margin:0 0 8px"><strong>Item:</strong> ${row.sku}</p>
            <p style="margin:0 0 8px"><strong>Remaining today:</strong> ${remainingStr}</p>
            <p style="margin:0 0 8px"><strong>Rule:</strong> ${thresholdLabel}</p>
            <p style="margin:12px 0 0;color:#555">This alert is sent once per day per item.</p>
          </div>
        `;

        alerts.push(
          (async () => {
            try {
              await sendEmail({ subject, html });
              await InventoryMovement.create({
                type: "low_stock",
                sku: row.sku,
                slug: row.slug,
                unit: row.unit,
                note: `remaining=${Math.round(row.remaining)} (${thresholdLabel})`,
              });
              // eslint-disable-next-line no-empty
            } catch {}
          })()
        );
      };

      const isRice = (name) => {
        const sl = normalizeSlug(name);
        return /friedrice|jollofrice|nativerice/.test(sl);
      };
      const isMoiMoiOrPlantain = (name) => {
        const sl = normalizeSlug(name);
        return /moimoi|moimo|moi|plantain|dodo/.test(sl);
      };

      // Foods (grams) – only rice variants under 900g
      for (const row of foodRows) {
        if (row._extra) continue; // skip display-only extra rows
        if (row.unit === "gram" && isRice(row.sku) && row.remaining < 900) {
          await enqueueAlert(row, "Rice (grams) < 900g");
        }
      }

      // Foods (pieces) – moimoi or plantain under 3 pcs
      for (const row of foodRows) {
        if (row.unit === "piece" && isMoiMoiOrPlantain(row.sku) && row.remaining < 3) {
          await enqueueAlert(row, "MoiMoi/Plantain < 3 pcs");
        }
      }

      // Drinks & Proteins (pieces) – any under 3 pcs
      for (const row of drinkRows) {
        if (row.unit === "piece" && row.remaining < 3) {
          await enqueueAlert(row, "Any Drink < 3 pcs");
        }
      }
      for (const row of proteinRows) {
        if (row.unit === "piece" && row.remaining < 3) {
          await enqueueAlert(row, "Any Protein < 3 pcs");
        }
      }

      // fire off all pending alerts
      if (alerts.length) await Promise.allSettled(alerts);
    } catch (e) {
      // never fail the summary because of email issues
      console.warn("Low-stock alert check failed:", e?.message || e);
    }
    // ---------- /LOW STOCK EMAIL ALERTS ----------

    res.json({ food: foodRows, drinks: drinkRows, proteins: proteinRows });
  } catch (e) {
    res.status(500).json({ error: e.message || "Failed to compute summary" });
  }
});

export default router;
