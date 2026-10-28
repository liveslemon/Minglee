import { Router } from "express";
import { adminNotificationController } from "../controllers/adminNotificationController.js";
import { adminPlatformController } from "../controllers/adminPlatformController.js";
import { adminAuthMiddleware } from "../middleware/adminAuth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const adminRoutes = Router();

adminRoutes.use(adminAuthMiddleware);

// Admin Telemetry & Statistics (dates of the week, active users, popups, categories)
adminRoutes.get("/stats", asyncHandler(adminPlatformController.getDashboardStats));
adminRoutes.get("/dashboard", asyncHandler(adminPlatformController.getDashboardStats));
adminRoutes.get("/stats/weekly-active-users", asyncHandler(adminPlatformController.getWeeklyActiveUsers));

// Ad Approval & Review Platform
adminRoutes.get("/ads/pending", asyncHandler(adminPlatformController.getPendingAds));
adminRoutes.post("/ads/:id/review", asyncHandler(adminPlatformController.reviewAd));

// Ticket Approval & Review Platform
adminRoutes.get("/tickets/pending", asyncHandler(adminPlatformController.getPendingTickets));
adminRoutes.post("/tickets/:id/review", asyncHandler(adminPlatformController.reviewTicket));

// Flagged Profiles Inspector
adminRoutes.get("/users/flagged", asyncHandler(adminPlatformController.getFlaggedUsers));
adminRoutes.post("/users/:id/flag", asyncHandler(adminPlatformController.updateUserFlag));

// Matching Cycle Trigger
adminRoutes.post("/matching/run", asyncHandler(adminPlatformController.runMatching));

// Push Notifications Dispatcher
adminRoutes.post("/notifications/send", asyncHandler(adminNotificationController.send));
