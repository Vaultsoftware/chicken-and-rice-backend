// ================================
// backend/routes/deliverymanRoutes.js
// ================================
import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Deliveryman from "../models/Deliveryman.js";
import Order from "../models/Order.js";

const router = express.Router();

// ---- Helpers ----
const normalizeEmail = (e = "") => String(e || "").toLowerCase().trim();
const JWT_SECRET =
  process.env.JWT_SECRET || (process.env.NODE_ENV !== "production" ? "dev_secret" : "");

// 🔐 Auth Middleware
function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "No token provided" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    if (!JWT_SECRET) {
      return res.status(500).json({ message: "Server config error (JWT_SECRET missing)" });
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, role, iat, exp }
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// ================================
// 📌 Helper: pick deliveryman with fewest active orders
// ================================
const pickSmartDeliveryman = async (excludeId = null) => {
  const query = { isOnline: true };
  if (excludeId) query._id = { $ne: excludeId };

  const online = await Deliveryman.find(query);
  if (!online?.length) return null;

  const loads = await Promise.all(
    online.map(async (dm) => {
      const active = await Order.countDocuments({
        assignedTo: dm._id,
        // ✅ include "accepted" as active
        status: { $in: ["pending", "assigned", "accepted", "in-transit"] },
      });
      return { deliveryman: dm, activeOrders: active };
    })
  );

  loads.sort((a, b) => a.activeOrders - b.activeOrders);
  return loads[0].deliveryman;
};

// 📌 Auto-assign pending orders
const autoAssignPendingOrders = async () => {
  try {
    const pendingOrders = await Order.find({ status: "pending" }).sort({ createdAt: 1 });
    for (const order of pendingOrders) {
      const deliveryman = await pickSmartDeliveryman();
      if (!deliveryman) break;
      order.assignedTo = deliveryman._id;
      order.status = "assigned";
      await order.save();
    }
  } catch (e) {
    console.error("autoAssignPendingOrders error:", e);
  }
};

// ================================
// 📌 Signup
// ================================
router.post("/signup", async (req, res) => {
  try {
    const { name, email, phone, password, address, dateOfBirth } = req.body || {};
    if (!name || !email || !phone || !password || !address) {
      return res.status(400).json({ message: "All required fields must be filled" });
    }

    const safeEmail = normalizeEmail(email);
    const existing = await Deliveryman.findOne({ email: safeEmail });
    if (existing) return res.status(400).json({ message: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newDeliveryman = new Deliveryman({
      name,
      email: safeEmail,
      phone,
      password: hashedPassword,
      address,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      isOnline: false,
      role: "deliveryman",
    });

    await newDeliveryman.save();

    if (!JWT_SECRET) {
      console.error("JWT_SECRET is not set");
      return res.status(500).json({ message: "Server config error (JWT)" });
    }

    const token = jwt.sign(
      { id: newDeliveryman._id, role: newDeliveryman.role },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.status(201).json({
      message: "Signup successful",
      token,
      user: { ...newDeliveryman.toObject(), password: undefined },
    });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// ================================
// 📌 Login
// ================================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const safeEmail = normalizeEmail(email);
    const deliveryman = await Deliveryman.findOne({ email: safeEmail });
    if (!deliveryman) return res.status(404).json({ message: "Not found" });

    if (!deliveryman.password) {
      // Handle legacy records without password
      return res.status(500).json({ message: "Account not configured for password login" });
    }

    const match = await bcrypt.compare(String(password), String(deliveryman.password));
    if (!match) return res.status(401).json({ message: "Invalid credentials" });

    if (!JWT_SECRET) {
      console.error("JWT_SECRET is not set");
      return res.status(500).json({ message: "Server config error (JWT)" });
    }

    const token = jwt.sign(
      { id: deliveryman._id, role: deliveryman.role || "deliveryman" },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    const updatedDeliveryman = await Deliveryman.findByIdAndUpdate(
      deliveryman._id,
      { isOnline: true },
      { new: true }
    ).select("-password");

    await autoAssignPendingOrders();

    res.json({ token, user: updatedDeliveryman.toObject() });
  } catch (err) {
    console.error("Delivery login error:", err);
    res.status(500).json({ message: "Server error during login" });
  }
});

// 📌 Logout
router.post("/logout", auth, async (req, res) => {
  try {
    const deliveryman = await Deliveryman.findByIdAndUpdate(
      req.user.id,
      { isOnline: false },
      { new: true }
    ).select("-password");
    if (!deliveryman) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Logged out successfully", user: deliveryman });
  } catch (err) {
    res.status(500).json({ message: "Server error during logout" });
  }
});

// 📌 Toggle Online/Offline
router.put("/status", auth, async (req, res) => {
  try {
    const { isOnline } = req.body || {};
    const deliveryman = await Deliveryman.findByIdAndUpdate(
      req.user.id,
      { isOnline: Boolean(isOnline) },
      { new: true }
    ).select("-password");
    if (!deliveryman) return res.status(404).json({ message: "Not found" });
    if (isOnline) await autoAssignPendingOrders();
    res.json({ user: deliveryman });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ================================
// 📌 Profile
// ================================
router.get("/profile", auth, async (req, res) => {
  try {
    const deliveryman = await Deliveryman.findById(req.user.id).select("-password");
    if (!deliveryman) return res.status(404).json({ message: "Deliveryman not found" });
    res.json(deliveryman);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ================================
// 📌 Order Actions
// ================================
router.post("/orders/:id/accept", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate("assignedTo", "name phone email");
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (String(order.assignedTo?._id) !== req.user.id) {
      return res.status(403).json({ message: "Not your order" });
    }
    order.status = "accepted";
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/orders/:id/decline", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (String(order.assignedTo) !== req.user.id) {
      return res.status(403).json({ message: "Not your order" });
    }

    const newDm = await pickSmartDeliveryman(req.user.id);
    if (newDm) {
      order.assignedTo = newDm._id;
      order.status = "assigned";
    } else {
      order.assignedTo = null;
      order.status = "pending";
    }

    await order.save();
    await order.populate("assignedTo", "name phone email");
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/orders/:id/in-transit", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (String(order.assignedTo) !== req.user.id)
      return res.status(403).json({ message: "Not your order" });

    order.status = "in-transit";
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/orders/:id/deliver", auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (String(order.assignedTo) !== req.user.id)
      return res.status(403).json({ message: "Not your order" });

    order.status = "delivered";
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================================
// 📌 Order lists
// ================================
router.get("/orders/history", auth, async (req, res) => {
  try {
    const orders = await Order.find({
      assignedTo: req.user.id,
      status: "delivered",
    }).sort({ updatedAt: -1 });

    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/orders/assigned", auth, async (req, res) => {
  try {
    const orders = await Order.find({
      assignedTo: req.user.id,
      // ✅ include "accepted" so it stays visible after Accept
      status: { $in: ["assigned", "accepted", "in-transit"] }
    }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================================
router.get("/all", async (req, res) => {
  try {
    const deliverymen = await Deliveryman.find().select("-password");
    res.json(deliverymen);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
