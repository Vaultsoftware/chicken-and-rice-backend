// ============================================================================
// File: backend/routes/facebook.js  (ESM, EMQ-boosted / add-only)
// ============================================================================
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const router = express.Router();

/* ------------------------- Env ------------------------- */
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

const APP_SECRET =
  process.env.META_APP_SECRET ||
  process.env.FB_APP_SECRET ||
  process.env.FACEBOOK_APP_SECRET ||
  ""; // optional but recommended

const FB_VERSION = process.env.META_GRAPH_VERSION || process.env.FB_API_VERSION || "v21.0";
const TEST_EVENT_CODE = process.env.FB_TEST_EVENT_CODE || process.env.META_TEST_EVENT_CODE || "";

/* ----------------------- Helpers (why-only comments) ----------------------- */
const sha256 = (v) =>
  v ? crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex") : undefined;

const hmacAppSecretProof = (token, secret) =>
  token && secret ? crypto.createHmac("sha256", secret).update(token).digest("hex") : undefined;

const parseCookie = (hdr = "") =>
  hdr.split(";").reduce((acc, part) => {
    const [k, ...v] = part.trim().split("=");
    if (!k) return acc;
    acc[k] = decodeURIComponent(v.join("="));
    return acc;
  }, {});

const clientIp = (req) => {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket?.remoteAddress || undefined;
};

const normalizePhoneForHash = (phone, country = "NG") => {
  if (!phone) return undefined;
  let s = String(phone).replace(/[^\d+]/g, "");
  if (s.startsWith("0")) {
    if ((country || "").toUpperCase() === "NG") s = "234" + s.slice(1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  return s || undefined;
};

function getFbcFbp(req, explicit = {}) {
  const cookies = parseCookie(req.headers.cookie || "");
  let fbp = explicit.fbp || cookies["_fbp"];
  let fbc = explicit.fbc || cookies["_fbc"];

  // Build _fbc from fbclid when available (click-through attribution)
  try {
    const rawUrl =
      explicit.event_source_url ||
      `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const url = new URL(rawUrl);
    const fbclid = url.searchParams.get("fbclid");
    if (fbclid && !fbc) {
      const ts = Math.floor(Date.now() / 1000);
      fbc = `fb.1.${ts}.${fbclid}`;
    }
  } catch {}

  return { fbc, fbp };
}

function buildUserData(req, extras = {}, explicit = {}) {
  const ua = req.headers["user-agent"] ? String(req.headers["user-agent"]) : undefined;
  const { fbc, fbp } = getFbcFbp(req, explicit);

  const out = {
    client_ip_address: clientIp(req),
    client_user_agent: ua,
    ...(fbc ? { fbc } : {}),
    ...(fbp ? { fbp } : {}),
  };

  // Arrays per Meta spec
  const addArrayHash = (key, val) => {
    const h = sha256(val);
    if (h) out[key] = [h];
  };
  // Singles per Meta spec
  const addSingleHash = (key, val) => {
    const h = sha256(val);
    if (h) out[key] = h;
  };

  // Arrays
  addArrayHash("em", extras.email);
  addArrayHash("ph", normalizePhoneForHash(extras.phone, extras.country || "NG"));
  addArrayHash("external_id", extras.external_id);

  // Singles
  addSingleHash("fn", extras.first_name || extras.fn);
  addSingleHash("ln", extras.last_name || extras.ln);
  addSingleHash("ct", extras.city || extras.ct);
  addSingleHash("st", extras.state || extras.st);
  addSingleHash("zp", extras.zip || extras.zp);
  addSingleHash("country", extras.country || "NG");

  return out;
}

const safeEventTime = (t) => {
  const now = Math.floor(Date.now() / 1000);
  const n = Number(t);
  if (!Number.isFinite(n)) return now;
  const sevenDays = 7 * 24 * 60 * 60;
  if (n > now + 300) return now;
  if (n < now - sevenDays) return now;
  return Math.floor(n);
};

/* ============================================================================
POST /api/facebook/conversion
Body:
{
  event_id, event_name?, value?, currency?, customer?, items?,
  event_source_url?, event_time?, fbp?, fbc?, test_event_code?
}
============================================================================ */
router.post("/conversion", async (req, res) => {
  try {
    if (!ACCESS_TOKEN || !PIXEL_ID) {
      return res.status(400).json({ error: "Missing META/FACEBOOK ACCESS_TOKEN or PIXEL_ID" });
    }

    const {
      event_id,                         // must equal Pixel {eventID}
      event_name = "Purchase",
      value = 0,
      currency = "NGN",
      customer = {},                    // { email, phone, external_id, first_name, last_name, ... }
      items = [],                       // [{ id, quantity, item_price }]
      event_source_url,
      event_time,
      fbp,
      fbc,
      test_event_code = TEST_EVENT_CODE
    } = req.body || {};

    if (!event_id) {
      return res.status(400).json({ error: "event_id required (dedup with pixel)" });
    }

    const user_data = buildUserData(
      req,
      customer || {},
      { fbp, fbc, event_source_url }
    );

    const payload = {
      data: [
        {
          event_name,
          event_time: safeEventTime(event_time),
          event_id: String(event_id),
          action_source: "website",
          event_source_url:
            event_source_url || `${req.protocol}://${req.get("host")}${req.originalUrl}`,
          user_data,
          custom_data: {
            currency: String(currency || "NGN").toUpperCase(),
            value: Number(value) || 0,
            contents: Array.isArray(items)
              ? items.map((it) => ({
                  id: String(it.id),
                  quantity: Number(it.quantity || 1),
                  item_price: Number(it.item_price || 0),
                }))
              : [],
            content_ids: Array.isArray(items) ? items.map((it) => String(it.id)) : [],
            content_type: "product",
          },
        },
      ],
      ...(test_event_code ? { test_event_code } : {}),
      access_token: ACCESS_TOKEN, // kept for compatibility
      partner_agent: "capi-enhanced/1.2"
    };

    // Harden with appsecret_proof; keep token also in URL for resilience
    const qs = new URLSearchParams();
    qs.set("access_token", ACCESS_TOKEN);
    const proof = hmacAppSecretProof(ACCESS_TOKEN, APP_SECRET);
    if (proof) qs.set("appsecret_proof", proof);

    const urlBase = `https://graph.facebook.com/${FB_VERSION}/${encodeURIComponent(PIXEL_ID)}/events`;
    const url = `${urlBase}?${qs.toString()}`;

    // Safe debug (don’t print hashes)
    if (process.env.CAPI_DEBUG === "1") {
      const dbg = {
        ...payload,
        data: payload.data.map((e) => ({
          ...e,
          user_data: {
            ...e.user_data,
            em: e.user_data.em ? ["[sha256]"] : undefined,
            ph: e.user_data.ph ? ["[sha256]"] : undefined,
            external_id: e.user_data.external_id ? ["[sha256]"] : undefined,
            fn: e.user_data.fn ? "[sha256]" : undefined,
            ln: e.user_data.ln ? "[sha256]" : undefined,
            ct: e.user_data.ct ? "[sha256]" : undefined,
            st: e.user_data.st ? "[sha256]" : undefined,
            zp: e.user_data.zp ? "[sha256]" : undefined,
            country: e.user_data.country ? "[sha256]" : undefined,
          },
        })),
      };
      console.info("[CAPI] ->", JSON.stringify(dbg, null, 2));
    }

    const fbRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await fbRes.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }

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

/* ============================================================================
GET /api/facebook/test?eventId=123&email=a@b.com
Sends a tiny Purchase to Test Events.
============================================================================ */
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
            content_type: "product",
          },
        },
      ],
      ...(TEST_EVENT_CODE ? { test_event_code: TEST_EVENT_CODE } : {}),
      access_token: ACCESS_TOKEN,
      partner_agent: "capi-enhanced/1.2"
    };

    const qs = new URLSearchParams();
    qs.set("access_token", ACCESS_TOKEN);
    const proof = hmacAppSecretProof(ACCESS_TOKEN, APP_SECRET);
    if (proof) qs.set("appsecret_proof", proof);

    const url = `https://graph.facebook.com/${FB_VERSION}/${encodeURIComponent(PIXEL_ID)}/events?${qs.toString()}`;
    const fbRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await fbRes.json();
    if (!fbRes.ok) return res.status(502).json({ ok: false, meta: json });

    res.json({ ok: true, eventId, meta: json });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || "unknown" });
  }
});

export default router;
