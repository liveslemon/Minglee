import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authMiddleware } from "../middleware/auth.js";
import * as matchController from "../controllers/matchController.js";
import * as messageController from "../controllers/messageController.js";

export const matchRoutes = Router();

matchRoutes.use(authMiddleware);

matchRoutes.get("/current", asyncHandler(matchController.getCurrentMatch));
matchRoutes.post("/:id/feedback", asyncHandler(matchController.submitFeedback));
matchRoutes.get("/:id/messages", asyncHandler(messageController.listMessages));
matchRoutes.post("/:id/messages", asyncHandler(messageController.sendMessage));
