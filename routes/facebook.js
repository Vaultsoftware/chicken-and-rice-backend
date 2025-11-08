// ============================================================================
// File: backend/routes/facebook.js
// ============================================================================
import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const router = express.Router();

// Accept both META_* and FB_* env names
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

const FB_VERSION = process.env.META_GRAPH_VERSION || "v20.0";

router.post("/conversion", async (req, res) => {
  try {
    if (!ACCESS_TOKEN || !PIXEL_ID) {
      return res
        .status(400)
        .json({ error: "Missing META_ACCESS_TOKEN/FB_ACCESS_TOKEN or PIXEL_ID" });
    }

    const {
      event_name = "Purchase",
      value = 0,
      currency = "NGN",
      email = "",
      event_source_url = "https://chickenandrice.net",
      fbp = "",
      fbc = "",
      test_event_code = process.env.FB_TEST_EVENT_CODE || process.env.META_TEST_EVENT_CODE || ""
    } = req.body || {};

    const hashedEmail =
      email && String(email).trim()
        ? crypto
            .createHash("sha256")
            .update(String(email).trim().toLowerCase())
            .digest("hex")
        : null;

    const user_data = {};
    if (hashedEmail) user_data.em = [hashedEmail];
    if (fbc) user_data.fbc = fbc;
    if (fbp) user_data.fbp = fbp;

    const payload = {
      data: [
        {
          event_name,
          event_time: Math.floor(Date.now() / 1000),
          action_source: "website",
          event_source_url,
          user_data,
          custom_data: {
            currency,
            value: Number(value) || 0
          }
        }
      ],
      ...(test_event_code ? { test_event_code } : {})
    };

    const url = `https://graph.facebook.com/${FB_VERSION}/${encodeURIComponent(
      PIXEL_ID
    )}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;

    const fbRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await fbRes.json();
    if (!fbRes.ok) {
      console.error("❌ Meta API Error:", json);
      return res.status(500).json({ ok: false, meta: json });
    }
    return res.json({ ok: true, meta: json });
  } catch (err) {
    console.error("❌ Facebook API Error:", err);
    return res.status(500).json({ ok: false, error: err?.message || "unknown" });
  }
});

export default router;
