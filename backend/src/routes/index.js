import { Router } from "express";
import { authRoutes } from "./authRoutes.js";
import { onboardingRoutes } from "./onboardingRoutes.js";

export const routes = Router();

routes.get("/health", (_req, res) => res.json({ ok: true }));

routes.use("/auth", authRoutes);
routes.use("/", onboardingRoutes);


