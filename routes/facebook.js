// ============================================================================
// File: backend/routes/facebook.js  (ESM)
// ============================================================================
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const router = express.Router();

// --- Env (supports multiple names) ---
const ACCESS_TOKEN =
  process.env.META_ACCESS_TOKEN ||
  process.env.FB_ACCESS_TOKEN ||
  process.env.FACEBOOK_ACCESS_TOKEN ||
  "";

const PIXEL_ID =
  process.env.META_PIXEL_ID ||
  process.env.FB_PIXEL_ID ||
  process.env.FACEBOOK_PIXEL_ID ||
  "";

const FB_VERSION = process.env.META_GRAPH_VERSION || process.env.FB_API_VERSION || "v21.0";
const TEST_EVENT_CODE = process.env.FB_TEST_EVENT_CODE || process.env.META_TEST_EVENT_CODE || "";

// --- Helpers (only "why" comments) ---
const sha256 = (v) =>
  v ? crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex") : undefined;

const parseCookie = (hdr = "") =>
  hdr.split(";").reduce((acc, part) => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return acc;
    acc[k] = decodeURIComponent(v.join("="));
    return acc;
  }, {});

function getFbcFbp(req) {
  const cookies = parseCookie(req.headers.cookie || "");
  const fbp = cookies["_fbp"];
  let fbc = cookies["_fbc"];

  // Build _fbc when we have fbclid (ad click)
  try {
    const url = new URL(`${req.protocol}://${req.get("host")}${req.originalUrl}`);
    const fbclid = url.searchParams.get("fbclid");
    if (fbclid) {
      const ts = Math.floor(Date.now() / 1000);
      fbc = `fb.1.${ts}.${fbclid}`;
    }
  } catch (_) {}

  return { fbc, fbp };
}

function buildUserData(req, extras = {}) {
  const ip =
    (req.headers["x-forwarded-for"] && String(req.headers["x-forwarded-for"]).split(",")[0].trim()) ||
    req.socket?.remoteAddress ||
    undefined;
  const ua = req.headers["user-agent"] ? String(req.headers["user-agent"]) : undefined;
  const { fbc, fbp } = getFbcFbp(req);

  const out = {
    client_ip_address: ip,
    client_user_agent: ua,
    ...(fbc ? { fbc } : {}),
    ...(fbp ? { fbp } : {}),
  };

  // Meta expects arrays for hashed identifiers
  const addHash = (key, val) => {
    const h = sha256(val);
    if (h) out[key] = [h];
  };

  addHash("em", extras.email);
  addHash("ph", extras.phone);
  addHash("external_id", extras.external_id);
  addHash("fn", extras.first_name);
  addHash("ln", extras.last_name);
  addHash("ct", extras.city);
  addHash("st", extras.state);
  addHash("zp", extras.zip);
  addHash("country", extras.country);

  return out;
}

// ============================================================================
// POST /api/facebook/conversion
// Body:
//   { event_id, event_name?, value?, currency?, customer?, items?, event_source_url?, test_event_code? }
// ============================================================================
router.post("/conversion", async (req, res) => {
  try {
    if (!ACCESS_TOKEN || !PIXEL_ID) {
      return res.status(400).json({ error: "Missing META/FACEBOOK ACCESS_TOKEN or PIXEL_ID" });
    }

    const {
      event_id,                         // REQUIRED: must equal pixel {eventID}
      event_name = "Purchase",
      value = 0,
      currency = "NGN",
      customer = {},                    // { email, phone, external_id, first_name, last_name, ... }
      items = [],                       // [{ id, quantity, item_price }]
      event_source_url,                 // recommended
      test_event_code = TEST_EVENT_CODE // for Test Events tab
    } = req.body || {};

    if (!event_id) {
      return res.status(400).json({ error: "event_id required (dedup with pixel)" });
    }

    const user_data = buildUserData(req, customer);

    const payload = {
      data: [
        {
          event_name,
          event_time: Math.floor(Date.now() / 1000),
          event_id: String(event_id),
          action_source: "website",
          event_source_url:
            event_source_url || `${req.protocol}://${req.get("host")}${req.originalUrl}`,
          user_data,
          custom_data: {
            currency,
            value: Number(value) || 0,
            contents: items.map((it) => ({
              id: String(it.id),
              quantity: Number(it.quantity || 1),
              item_price: Number(it.item_price || 0)
            })),
            content_ids: items.map((it) => String(it.id)),
            content_type: "product"
          }
        }
      ],
      ...(test_event_code ? { test_event_code } : {}),
      access_token: ACCESS_TOKEN
    };

    const url = `https://graph.facebook.com/${FB_VERSION}/${encodeURIComponent(PIXEL_ID)}/events`;

    // Safe debug (don’t print hashes)
    const dbg = {
      ...payload,
      data: [
        {
          ...payload.data[0],
          user_data: {
            ...payload.data[0].user_data,
            em: payload.data[0].user_data.em ? ["[sha256]"] : undefined,
            ph: payload.data[0].user_data.ph ? ["[sha256]"] : undefined,
            external_id: payload.data[0].user_data.external_id ? ["[sha256]"] : undefined
          }
        }
      ]
    };
    console.info("[CAPI] ->", JSON.stringify(dbg, null, 2));

    const fbRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await fbRes.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }

    if (!fbRes.ok) {
      console.error("❌ Meta API Error:", json);
      return res.status(502).json({ ok: false, meta: json });
    }

    console.info("[CAPI] <-", json);
    return res.json({ ok: true, meta: json });
  } catch (err) {
    console.error("❌ Facebook CAPI Error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "unknown" });
  }
});

// ============================================================================
// GET /api/facebook/test?eventId=123&email=a@b.com
// Sends a tiny Purchase to Test Events (uses TEST_EVENT_CODE).
// ============================================================================
router.get("/test", async (req, res) => {
  try {
    if (!ACCESS_TOKEN || !PIXEL_ID) {
      return res.status(400).json({ error: "Missing META/FACEBOOK ACCESS_TOKEN or PIXEL_ID" });
    }

    const eventId = String(req.query.eventId || `evt_${Date.now()}`);
    const user_data = buildUserData(req, { email: req.query.email });

    const payload = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: "website",
          event_source_url: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
          user_data,
          custom_data: {
            currency: "NGN",
            value: 1,
            contents: [{ id: "sku-test", quantity: 1, item_price: 1 }],
            content_ids: ["sku-test"],
            content_type: "product"
          }
        }
      ],
      ...(TEST_EVENT_CODE ? { test_event_code: TEST_EVENT_CODE } : {}),
      access_token: ACCESS_TOKEN
    };

    const url = `https://graph.facebook.com/${FB_VERSION}/${encodeURIComponent(PIXEL_ID)}/events`;
    const fbRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await fbRes.json();
    if (!fbRes.ok) return res.status(502).json({ ok: false, meta: json });

    res.json({ ok: true, eventId, meta: json });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "unknown" });
  }
});

export default router;
