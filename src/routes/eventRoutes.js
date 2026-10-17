import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authMiddleware } from "../middleware/auth.js";
import * as eventController from "../controllers/eventController.js";

export const eventRoutes = Router();

eventRoutes.get("/", asyncHandler(eventController.listEvents));
eventRoutes.post("/", authMiddleware, asyncHandler(eventController.createEvent));
eventRoutes.post(
  "/register",
  authMiddleware,
  asyncHandler(eventController.registerForEvent),
);
