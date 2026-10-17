import { Router } from "express";
import { authRoutes } from "./authRoutes.js";
import { eventRoutes } from "./eventRoutes.js";
import { matchRoutes } from "./matchRoutes.js";
import { onboardingRoutes } from "./onboardingRoutes.js";
import { safetyRoutes } from "./safetyRoutes.js";
import { whatsappRoutes } from "./whatsappRoutes.js";
import { adRoutes } from "../../backend/ads/index.js";
import { notificationRoutes } from "../../backend/notifications/index.js";
import { paymentRoutes } from "../../backend/payments/index.js";
import { adminRoutes } from "./adminRoutes.js";

export const routes = Router();

routes.get("/health", (_req, res) => res.json({ ok: true }));

routes.use("/auth", authRoutes);
routes.use("/events", eventRoutes);
routes.use("/matches", matchRoutes);
routes.use("/whatsapp", whatsappRoutes);
routes.use("/ads", adRoutes);
routes.use("/notifications", notificationRoutes);
routes.use("/payments", paymentRoutes);
routes.use("/admin", adminRoutes);
// POST /reports, POST /users/:id/block. Must stay before onboardingRoutes,
// which applies auth to everything under "/".
routes.use("/", safetyRoutes);
routes.use("/", onboardingRoutes);
