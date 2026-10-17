import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authMiddleware } from "../middleware/auth.js";
import * as matchController from "../controllers/matchController.js";

export const matchRoutes = Router();

matchRoutes.get("/current", authMiddleware, asyncHandler(matchController.getCurrentMatch));
