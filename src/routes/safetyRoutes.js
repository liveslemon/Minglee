import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authMiddleware } from "../middleware/auth.js";
import * as safetyController from "../controllers/safetyController.js";

// Mounted at "/" (before onboardingRoutes); auth is per-route so this router
// doesn't affect other paths.
export const safetyRoutes = Router();

safetyRoutes.post("/reports", authMiddleware, asyncHandler(safetyController.createReport));
safetyRoutes.post("/users/:id/block", authMiddleware, asyncHandler(safetyController.blockUser));
