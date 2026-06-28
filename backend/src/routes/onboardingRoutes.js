import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authMiddleware } from "../middleware/auth.js";
import * as onboardingController from "../controllers/onboardingController.js";
import multer from "multer";

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB limit
});

export const onboardingRoutes = Router();

// All onboarding/profile endpoints require authentication.
onboardingRoutes.use(authMiddleware);

onboardingRoutes.post("/profile", asyncHandler(onboardingController.upsertProfile));
onboardingRoutes.post("/preferences", asyncHandler(onboardingController.upsertPreferences));
onboardingRoutes.post("/focuses", asyncHandler(onboardingController.saveFocuses));
onboardingRoutes.post("/preferred-builds", asyncHandler(onboardingController.savePreferredBuilds));
onboardingRoutes.post("/photos/upload", upload.single('file'), asyncHandler(onboardingController.uploadPhoto));
onboardingRoutes.post("/photos", asyncHandler(onboardingController.savePhotos));
onboardingRoutes.get("/me/profile", asyncHandler(onboardingController.getMeProfile));
