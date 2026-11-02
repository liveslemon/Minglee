import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authMiddleware } from "../middleware/auth.js";
import * as safetyController from "../controllers/safetyController.js";

export const safetyRoutes = Router();

safetyRoutes.use(authMiddleware);

safetyRoutes.post("/reports", asyncHandler(safetyController.createReport));
safetyRoutes.post("/users/:id/block", asyncHandler(safetyController.blockUser));
