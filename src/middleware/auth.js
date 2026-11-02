import "../env.js";
import jwt from "jsonwebtoken";
import { ApiError } from "../utils/apiError.js";
import { trackWeeklyActiveUser } from "../services/weeklyActiveUsersService.js";

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error("Missing JWT_SECRET");

export function signAccessToken({ userId, role }) {
  return jwt.sign({ sub: userId, role }, jwtSecret, { expiresIn: "30d" });
}

export function authMiddleware(req, _res, next) {
  const authHeader = req.header("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) return next(new ApiError(401, "Missing Bearer token"));

  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return next(new ApiError(401, "Invalid token"));
  }

  const userId = typeof payload?.sub === "string" ? payload.sub : null;
  if (!userId) return next(new ApiError(401, "Invalid token"));

  req.user = { id: userId, role: payload?.role ?? null };
  trackWeeklyActiveUser(userId);
  return next();
}
