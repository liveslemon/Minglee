import { Router } from "express";
import { adController } from "./adController.js";
import { authMiddleware } from "../../src/middleware/auth.js";
import { uploadAnyImage } from "../../src/middleware/upload.js";
import { asyncHandler } from "../../src/utils/asyncHandler.js";

export const adRoutes = Router();

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
// Resolves a single approved ad, e.g. the popup a "notification" ad deep-links to.
adRoutes.get("/:id", asyncHandler(adController.getAdById));
