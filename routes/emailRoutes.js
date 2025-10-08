// backend/routes/emailRoutes.js
import express from "express";
import { sendEmail } from "../utils/mailer.js";

const router = express.Router();

const money = (n) =>
  "₦" +
  (Number(n || 0)).toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

/**
 * Generic email sender (already had)
 * POST /api/email
 * Body: { to?, subject, html?, text?, from? }
 */
router.post("/", async (req, res) => {
  try {
    const { to, subject, html, text, from } = req.body || {};
    if (!subject || (!html && !text)) {
      return res.status(400).json({ error: "subject and html or text are required" });
    }
    await sendEmail({ to, subject, html, text, from });
    res.json({ ok: true });
  } catch (e) {
    console.error("Email send error:", e);
    res.status(500).json({ error: "Failed to send email" });
  }
});

/**
 * Daily in-shop sales report used by your "Close Sales" button.
 * POST /api/email/send-sales-report
 * Body: { amount, cash, card, transfer, date }
 */
router.post("/send-sales-report", async (req, res) => {
  try {
    const { amount, cash, card, transfer, date } = req.body || {};
    const when = date || new Date().toISOString().split("T")[0];

    const html = `
      <div style="font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;line-height:1.4;color:#111">
        <h2 style="margin:0 0 8px">🧾 Daily In-Shop Sales Report</h2>
        <p style="margin:0 0 12px;color:#444">Date: <strong>${when}</strong></p>
        <table style="border-collapse:collapse;width:100%;max-width:520px">
          <tbody>
            <tr><td style="padding:8px;border:1px solid #eee">Cash</td><td style="padding:8px;border:1px solid #eee"><strong>${money(cash)}</strong></td></tr>
            <tr><td style="padding:8px;border:1px solid #eee">Card</td><td style="padding:8px;border:1px solid #eee"><strong>${money(card)}</strong></td></tr>
            <tr><td style="padding:8px;border:1px solid #eee">Transfer</td><td style="padding:8px;border:1px solid #eee"><strong>${money(transfer)}</strong></td></tr>
            <tr><td style="padding:8px;border:1px solid #eee;background:#fafafa"><strong>Total</strong></td><td style="padding:8px;border:1px solid #eee;background:#fafafa"><strong>${money(amount)}</strong></td></tr>
          </tbody>
        </table>
        <p style="margin:16px 0 0;color:#666">Sent automatically from Cashier.</p>
      </div>
    `;

    await sendEmail({
      subject: `In-Shop Sales – ${when} – ${money(amount)}`,
      html,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("Sales report email error:", e?.message || e);
    res.status(500).json({ error: "Failed to send email" });
  }
});

export default router;
