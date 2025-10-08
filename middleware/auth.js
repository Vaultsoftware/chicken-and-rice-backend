// middleware/auth.js
import jwt from "jsonwebtoken";

/**
 * Authentication middleware
 * - Verifies JWT from "Authorization: Bearer <token>"
 * - Attaches decoded user { id, role } to req.user
 */
export function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1]; // Expect "Bearer <token>"
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user info to request
    req.user = { id: decoded.id, role: decoded.role };

    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

/**
 * Role-based authorization middleware
 * - Usage: app.get("/admin", auth, authorizeRoles("admin"), handler)
 */
export function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}
