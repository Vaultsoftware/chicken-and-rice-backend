// ============================================================================
// File: backend/routes/ocr.js
// ============================================================================
import express from "express";
import { upload } from "../middleware/upload.js";

const router = express.Router();

/* -------- PDF text extraction (pdf.js v4 fallback-compatible) -------- */
async function extractPdfText(buffer) {
  try {
    const pdfjsLib = await import("pdfjs-dist/build/pdf");
    const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
    let out = "";
    const pages = Math.min(doc.numPages || 0, 15);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent({ includeMarkedContent: true });
      out += " " + (content.items || []).map((it) => it?.str ?? "").join(" ");
    }
    return (out || "").trim();
  } catch {
    return "";
  }
}

/* -------- Node Tesseract (tesseract.js v5) -------- */
async function recognizeWithTesseract(input) {
  const mod = await import("tesseract.js");
  const T = mod.default ?? mod;
  try {
    const { data } = await T.recognize(input, "eng", {
      tessedit_char_whitelist:
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ₦NnGg.,:-/&",
      tessedit_pageseg_mode: "6",
      user_defined_dpi: "360",
      preserve_interword_spaces: "1",
    });
    return (data?.text || "").trim();
  } catch {
    return "";
  }
}

router.post("/extract", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file required" });

    const mime = (req.file.mimetype || "").toLowerCase();
    const buf =
      req.file.buffer ||
      (req.file.path ? await (await import("fs/promises")).readFile(req.file.path) : null);
    if (!buf) return res.status(400).json({ error: "empty file" });

    if (mime.includes("pdf") || /\.pdf$/i.test(req.file.originalname || "")) {
      const text = await extractPdfText(buf);
      if (text && text.length >= 6) {
        return res.json({ ok: true, method: "server-pdf-text", text });
      }
      const ocr = await recognizeWithTesseract(buf);
      return res.json({ ok: !!ocr, method: "server-pdf-ocr", text: ocr || "" });
    }

    const text = await recognizeWithTesseract(buf);
    return res.json({ ok: !!text, method: "server-image-ocr", text: text || "" });
  } catch (e) {
    console.error("❌ /api/ocr/extract failed:", e?.message || e);
    return res.status(500).json({ ok: false, error: "ocr failed" });
  }
});

export default router;