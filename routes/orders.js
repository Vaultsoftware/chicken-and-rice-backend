// ================================
// backend/routes/orders.js
// ================================
import express from "express";
import Order from "../models/Order.js";
import Deliveryman from "../models/Deliveryman.js";
import { geocodeAddress } from "../utils/geocode.js";
import { sendEmail } from "../utils/mailer.js";

const router = express.Router();

// pick least-loaded online deliveryman
const pickSmartDeliveryman = async (excludeId = null) => {
  const query = { isOnline: true };
  if (excludeId) query._id = { $ne: excludeId };

  const online = await Deliveryman.find(query);
  if (!online?.length) return null;

  const loads = await Promise.all(
    online.map(async (dm) => {
      const active = await Order.countDocuments({
        assignedTo: dm._id,
        status: { $in: ["pending", "assigned", "accepted", "in-transit"] },
      });
      return { deliveryman: dm, activeOrders: active };
    })
  );

  loads.sort((a, b) => a.activeOrders - b.activeOrders);
  return loads[0].deliveryman;
};

// helpers for client-added prefixes
const stripAutoDetected = (s = "") =>
  String(s).replace(/^Auto\s*detected,?\s*/i, "").trim();
const stripUsingCurrentLocation = (s = "") =>
  String(s).replace(/^Using\s+(your\s+)?current\s+location,?\s*/i, "").trim();

// geo normalization
async function normalizeGeoLocation(raw, street = "", houseNumber = "") {
  const fallback = { type: "Point", coordinates: [3.3792, 6.5244] };
  if (!raw && !street) return fallback;

  if (raw?.type === "Point" && Array.isArray(raw.coordinates)) {
    let [lng, lat] = raw.coordinates.map(Number);
    const looksReversed = Math.abs(lng) <= 90 && Math.abs(lat) > 90;
    if (looksReversed) [lng, lat] = [lat, lng];
    return { type: "Point", coordinates: [lng, lat] };
  }

  if (raw?.lat != null && raw?.lng != null) {
    return { type: "Point", coordinates: [Number(raw.lng), Number(raw.lat)] };
  }

  const cleanedStreet = stripUsingCurrentLocation(stripAutoDetected(street));
  if (cleanedStreet) {
    const address = `${houseNumber || ""} ${cleanedStreet}`.trim();
    const coords = await geocodeAddress(address);
    if (coords) {
      return { type: "Point", coordinates: [coords.lng, coords.lat] };
    }
  }

  return fallback;
}

const money = (n) =>
  "₦" +
  (Number(n || 0)).toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

function escapeHtml(s = "") {
  return String(s)
    .replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

// ================================
// Create Order
// ================================
router.post("/", async (req, res) => {
  try {
    const body = req.body || {};
    const orderType = body.orderType || "online";

    const items = Array.isArray(body.items)
      ? body.items.map((it) => ({
          foodId: it.foodId,
          name: it.name,
          quantity: Number(it.quantity),
          price: Number(it.price),
        }))
      : [];

    const subtotal = Number(
      body.subtotal ??
        items.reduce((s, it) => s + (Number(it.price) * Number(it.quantity) || 0), 0)
    );
    const tax = Number(body.tax ?? 0);
    const deliveryFee = Number(body.deliveryFee ?? 0);
    const total = Number(body.total ?? subtotal + tax + deliveryFee);

    const rawPM = String(body.paymentMode || "").toLowerCase();
    let paymentMode = undefined;
    if (["cash", "card", "transfer"].includes(rawPM)) paymentMode = rawPM;
    else if (rawPM === "upi") paymentMode = "transfer"; // normalize older clients

    // ---- ADD: force chowdeck payment mode to transfer
    if (orderType === "chowdeck") {
      paymentMode = "transfer";
    }
    // ---- END ADD

    let orderData = {
      items,
      subtotal,
      tax,
      deliveryFee,
      total,
      specialNotes: body.specialNotes ?? "",
      orderType,
      paymentMode,
    };

    if (orderType === "online") {
      const normalizedLoc = await normalizeGeoLocation(
        body.location,
        body.street,
        body.houseNumber
      );

      orderData = {
        ...orderData,
        customerName: body.customerName,
        phone: body.phone,
        houseNumber: body.houseNumber,
        street: stripUsingCurrentLocation(stripAutoDetected(body.street || "")),
        landmark: body.landmark,
        location: normalizedLoc,
      };
    } else {
      // instore and chowdeck: no customer name/address (same handling)
      orderData = {
        ...orderData,
        customerName: body.customerName || "Walk-in Customer",
        phone: body.phone || "",
        houseNumber: "",
        street: "",
        landmark: "",
        location: { type: "Point", coordinates: [3.3792, 6.5244] },
      };
    }

    const order = new Order(orderData);

    if (orderType === "online") {
      const deliveryman = await pickSmartDeliveryman();
      if (deliveryman) {
        order.assignedTo = deliveryman._id;
        order.status = "assigned";
      } else {
        order.status = "pending";
      }
    }

    await order.save();
    await order.populate("assignedTo", "name email phone isOnline");

    // ====== EMAIL ON ONLINE ORDER ======
    if (orderType === "online") {
      try {
        const when = new Date(order.createdAt || Date.now());
        const dt = when.toLocaleString("en-NG", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        const itemsHtml = (order.items || [])
          .map(
            (it) => `
              <tr>
                <td style="padding:8px;border:1px solid #eee">${escapeHtml(it.name || "Item")}</td>
                <td style="padding:8px;border:1px solid #eee;text-align:center">${Number(it.quantity) || 0}</td>
                <td style="padding:8px;border:1px solid #eee;text-align:right">${money(it.price)}</td>
              </tr>
            `
          )
          .join("");

        const html = `
          <div style="font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;line-height:1.4;color:#111">
            <h2 style="margin:0 0 8px">🛒 New Online Order</h2>
            <p style="margin:0 0 12px;color:#444">Time: <strong>${dt}</strong></p>

            <h3 style="margin:16px 0 8px">Customer</h3>
            <table style="border-collapse:collapse;width:100%;max-width:560px">
              <tbody>
                <tr><td style="padding:8px;border:1px solid #eee">Name</td><td style="padding:8px;border:1px solid #eee"><strong>${escapeHtml(order.customerName || "-")}</strong></td></tr>
                <tr><td style="padding:8px;border:1px solid #eee">Phone</td><td style="padding:8px;border:1px solid #eee"><strong>${escapeHtml(order.phone || "-")}</strong></td></tr>
                <tr><td style="padding:8px;border:1px solid #eee">Address</td><td style="padding:8px;border:1px solid #eee"><strong>${escapeHtml([order.houseNumber, order.street, order.landmark].filter(Boolean).join(" "))}</strong></td></tr>
              </tbody>
            </table>

            <h3 style="margin:16px 0 8px">Items</h3>
            <table style="border-collapse:collapse;width:100%;max-width:560px">
              <thead>
                <tr>
                  <th style="padding:8px;border:1px solid #eee;text-align:left">Item</th>
                  <th style="padding:8px;border:1px solid #eee;text-align:center">Qty</th>
                  <th style="padding:8px;border:1px solid #eee;text-align:right">Price</th>
                </tr>
              </thead>
              <tbody>${itemsHtml}</tbody>
              <tfoot>
                <tr><td colspan="2" style="padding:8px;border:1px solid #eee;text-align:right">Subtotal</td><td style="padding:8px;border:1px solid #eee;text-align:right"><strong>${money(order.subtotal)}</strong></td></tr>
                <tr><td colspan="2" style="padding:8px;border:1px solid #eee;text-align:right">Delivery fee</td><td style="padding:8px;border:1px solid #eee;text-align:right"><strong>${money(order.deliveryFee)}</strong></td></tr>
                <tr><td colspan="2" style="padding:8px;border:1px solid #eee;text-align:right">Tax</td><td style="padding:8px;border:1px solid #eee;text-align:right"><strong>${money(order.tax)}</strong></td></tr>
                <tr><td colspan="2" style="padding:8px;border:1px solid #eee;text-align:right;background:#fafafa">Total</td><td style="padding:8px;border:1px solid #eee;text-align:right;background:#fafafa"><strong>${money(order.total)}</strong></td></tr>
              </tfoot>
            </table>

            <p style="margin:16px 0 0;color:#666">
              Payment: <strong>${escapeHtml(order.paymentMode || "-")}</strong>
              ${order.assignedTo ? `<br/>Assigned to: <strong>${escapeHtml(order.assignedTo.name || "")}</strong>` : ""}
            </p>
          </div>
        `;

        await sendEmail({
          subject: `New Online Order – ${money(order.total)} – ${order.customerName || ""}`,
          html,
        });
      } catch (e) {
        console.warn("Order email failed (non-fatal):", e?.message || e);
      }
    }

    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ error: err.message, received: req.body });
  }
});

// ================================
// Other getters and mutations
// ================================
router.get("/", async (req, res) => {
  try {
    const { type } = req.query;
    let filter = {};
    if (type) filter.orderType = type;
    const orders = await Order.find(filter).populate("assignedTo", "name email phone isOnline");
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/online", async (_req, res) => {
  try {
    const orders = await Order.find({ orderType: "online" }).populate(
      "assignedTo",
      "name email phone isOnline"
    );
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/instore", async (_req, res) => {
  try {
    const orders = await Order.find({ orderType: "instore" });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/assigned", async (_req, res) => {
  try {
    const orders = await Order.find({
      status: "assigned",
      orderType: { $in: ["online", null] },
    }).populate("assignedTo", "name email phone isOnline");
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!["accepted", "in-transit", "delivered", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "Invalid status update" });
    }
    const order = await Order.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    ).populate("assignedTo", "name email phone isOnline");
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/status/:status", async (req, res) => {
  try {
    const { status } = req.params;
    if (!["pending", "assigned", "accepted", "in-transit", "delivered", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "Invalid status filter" });
    }
    const orders = await Order.find({ status, orderType: "online" }).populate(
      "assignedTo",
      "name email phone isOnline"
    );
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// admin assign/reassign
router.patch("/:id/assign", async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedTo, status } = req.body;
    const update = {};
    if (assignedTo) update.assignedTo = assignedTo;
    if (status) update.status = status;
    const order = await Order.findByIdAndUpdate(id, update, { new: true })
      .populate("assignedTo", "name email phone isOnline");
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
