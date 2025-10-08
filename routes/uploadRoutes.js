// routes/uploadRoutes.js
import express from "express";
import { upload } from "../middleware/upload.js";

const router = express.Router();

router.post("/upload", upload.single("file"), (req, res) => {
  try {
    const filename = req.file?.filename;
    if (!filename) return res.status(400).json({ ok: false, error: "no file" });

    const base =
      process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
      "https://fastfolderbackend.fly.dev";

    const relative = `/uploads/${filename}`;
    const url = `${base}${relative}`;

    return res.json({
      ok: true,
      filename,
      path: relative, // e.g. "/uploads/123-my-file.jpg"
      url,            // e.g. "https://fastfolderbackend.fly.dev/uploads/123-my-file.jpg"
    });
  } catch (e) {
    console.error("upload error:", e?.message);
    return res.status(500).json({ ok: false, error: e?.message || "upload failed" });
  }
});

export default router;
