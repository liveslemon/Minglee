import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authIpRateLimit, loginFailureRateLimit } from "../middleware/rateLimit.js";
import * as authController from "../controllers/authController.js";

export const authRoutes = Router();

authRoutes.post("/signup", authIpRateLimit, asyncHandler(authController.signup));
authRoutes.post("/login", authIpRateLimit, loginFailureRateLimit, asyncHandler(authController.login));
