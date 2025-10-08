// backend/utils/mailer.js
import nodemailer from "nodemailer";

const DEFAULT_TO =
  process.env.EMAIL_TO_DEFAULT ||
  "chickenandriceltd@gmail.com"; // your default destination

function createTransport({ port, secure }) {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    console.warn("⚠️ EMAIL_USER or EMAIL_PASS not set. Emails will fail.");
  }

  // Gmail SMTP
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port,
    secure,                // true => 465, false => 587
    requireTLS: !secure,   // enforce TLS on 587
    auth: { user, pass },
    pool: true,
    maxConnections: 5,
    maxMessages: 50,
    connectionTimeout: 12000,
    greetingTimeout: 12000,
    socketTimeout: 12000,
  });
}

// one-shot sender with auto fallback: 587 → 465 if needed
export async function sendEmail({ to, subject, html, text, from }) {
  const envelope = {
    from: from || `"Chicken & Rice" <${process.env.EMAIL_USER || "no-reply@localhost"}>`,
    to: to || DEFAULT_TO,
    subject: subject || "(no subject)",
    html: html || undefined,
    text: text || undefined,
  };

  // first attempt: 587
  try {
    const t587 = createTransport({ port: 587, secure: false });
    const info = await t587.sendMail(envelope);
    console.log("📧 Email sent (587):", info.messageId);
    return info;
  } catch (e) {
    const code = (e && (e.code || e.name || e.message)) || "ERR";
    console.warn("✋ 587 send failed:", code, "-", e?.message || e);
    // fallback attempt: 465
    try {
      const t465 = createTransport({ port: 465, secure: true });
      const info2 = await t465.sendMail(envelope);
      console.log("📧 Email sent (465 fallback):", info2.messageId);
      return info2;
    } catch (e2) {
      console.error("❌ Email send failed (465 fallback):", e2?.message || e2);
      throw e2;
    }
  }
}
