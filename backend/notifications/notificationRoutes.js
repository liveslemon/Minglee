import { Router } from "express";
import { notificationController } from "./notificationController.js";
import { authMiddleware } from "../../src/middleware/auth.js";
import { adminAuthMiddleware } from "../../src/middleware/adminAuth.js";

export const notificationRoutes = Router();

// Creating notifications/popups and broadcasting is admin-only (x-admin-secret).
// Registered before the JWT middleware so admins don't also need a user token.
notificationRoutes.post("/popups", adminAuthMiddleware, notificationController.createPopup);
notificationRoutes.post("/trigger", adminAuthMiddleware, notificationController.triggerBroadcast);
notificationRoutes.post("/", adminAuthMiddleware, notificationController.createNotification);

// Everything below acts on the authenticated user's own notifications
notificationRoutes.use(authMiddleware);

notificationRoutes.post("/subscribe", notificationController.subscribe);
notificationRoutes.get("/popups", notificationController.getPopups);
notificationRoutes.get("/popups/active", notificationController.getPopups);
notificationRoutes.get("/unread", notificationController.getUnreadNotifications);
notificationRoutes.get("/", notificationController.getUserNotifications);

notificationRoutes.patch("/read-all", notificationController.markAllAsRead);
notificationRoutes.patch("/:id/read", notificationController.markAsRead);
notificationRoutes.patch("/:id/dismiss", notificationController.markAsDismissed);

notificationRoutes.delete("/:id", notificationController.deleteNotification);
