// ============================================================================
// File: backend/routes/facebook.js
// ============================================================================
import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';

const router = express.Router();

// Accept both META_* and FB_* envs
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || process.env.FB_ACCESS_TOKEN;
const PIXEL_ID = process.env.META_PIXEL_ID || process.env.FB_PIXEL_ID;
const FB_VERSION = process.env.META_GRAPH_VERSION || process.env.FB_GRAPH_VERSION || 'v20.0';
const TEST_EVENT_CODE = process.env.FB_TEST_EVENT_CODE || process.env.META_TEST_EVENT_CODE;

router.post('/conversion', async (req, res) => {
  try {
    const { event_name, value, currency, email, event_source_url, fbp, fbc } = req.body || {};

    if (!ACCESS_TOKEN || !PIXEL_ID) {
      return res.status(400).json({ error: 'Missing META_ACCESS_TOKEN/FB_ACCESS_TOKEN or META_PIXEL_ID/FB_PIXEL_ID' });
    }

    const hashedEmail = email
      ? crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex')
      : null;

    const user_data = {};
    if (hashedEmail) user_data.em = [hashedEmail];
    if (fbc) user_data.fbc = fbc;
    if (fbp) user_data.fbp = fbp;

    const payload = {
      data: [
        {
          event_name: event_name || 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          event_source_url: event_source_url || 'https://chickenandrice.net',
          user_data,
          custom_data: {
            currency: currency || 'NGN',
            value: Number(value) || 0,
          },
          ...(TEST_EVENT_CODE ? { test_event_code: TEST_EVENT_CODE } : {}),
        },
      ],
    };

    const url = `https://graph.facebook.com/${FB_VERSION}/${encodeURIComponent(PIXEL_ID)}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;
    const fbRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const json = await fbRes.json();
    if (!fbRes.ok) {
      console.error('❌ Meta API Error:', json);
      return res.status(500).json({ ok: false, meta: json });
    }
    return res.json({ ok: true, meta: json });
  } catch (err) {
    console.error('❌ Facebook API Error:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'unknown' });
  }
});

export default router;
