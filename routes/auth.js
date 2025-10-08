// backend/routes/auth.js
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";

const router = express.Router();
const JWT_SECRET =
  process.env.JWT_SECRET || (process.env.NODE_ENV !== "production" ? "dev_secret" : "");

const normalizeEmail = (e = "") => String(e).trim().toLowerCase();

// POST /api/admin/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const admin = await Admin.findOne({ email: normalizeEmail(email) });
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    const ok = await bcrypt.compare(String(password), String(admin.password));
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    if (!JWT_SECRET) {
      return res.status(500).json({ message: "Server config error (JWT secret missing)" });
    }

    const token = jwt.sign({ id: admin._id, role: "admin" }, JWT_SECRET, { expiresIn: "1d" });

    res.json({
      token,
      user: { id: admin._id, name: admin.name, email: admin.email, role: "admin" },
    });
  } catch (err) {
    console.error("❌ Admin login error:", err);
    res.status(500).json({ message: "Server error during admin login" });
  }
});

// (Optional) quick check
router.get("/exists", async (_req, res) => {
  const count = await Admin.countDocuments({});
  res.json({ admins: count });
});

export default router;
