import { Router } from "express";
import { adController } from "./adController.js";
import { authMiddleware } from "../../src/middleware/auth.js";
import { uploadAnyImage } from "../../src/middleware/upload.js";
import { asyncHandler } from "../../src/utils/asyncHandler.js";

export const adRoutes = Router();

// Moderation (pending list / review) lives under /admin/ads and requires the admin secret.

adRoutes.post(
  "/upload",
  authMiddleware,
  uploadAnyImage,
  asyncHandler(adController.uploadImage)
);
adRoutes.get("/availability/:ad_type/:date", asyncHandler(adController.checkAvailability));
adRoutes.post("/", authMiddleware, asyncHandler(adController.createAd));
adRoutes.get("/", asyncHandler(adController.getActiveAds));
adRoutes.post("/:id/impression", asyncHandler(adController.trackImpression));
adRoutes.post("/:id/click", asyncHandler(adController.trackClick));
