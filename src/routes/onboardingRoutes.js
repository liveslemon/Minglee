import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { authMiddleware } from "../middleware/auth.js";
import * as onboardingController from "../controllers/onboardingController.js";
import multer from "multer";
import { ApiError } from "../utils/apiError.js";

const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
  fileFilter(_req, file, cb) {
    if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      cb(
        new ApiError(
          400,
          "Only image files are allowed (JPEG, PNG, WebP, GIF)",
        ),
      );
      return;
    }
    cb(null, true);
  },
});

export const onboardingRoutes = Router();

// All onboarding/profile endpoints require authentication.
onboardingRoutes.use(authMiddleware);

onboardingRoutes.post(
  "/profile",
  asyncHandler(onboardingController.upsertProfile),
);
onboardingRoutes.post(
  "/preferences",
  asyncHandler(onboardingController.upsertPreferences),
);
onboardingRoutes.post(
  "/focuses",
  asyncHandler(onboardingController.saveFocuses),
);
onboardingRoutes.post(
  "/preferred-builds",
  asyncHandler(onboardingController.savePreferredBuilds),
);
onboardingRoutes.post(
  "/photos/upload",
  upload.single("file"),
  asyncHandler(onboardingController.uploadPhoto),
);
onboardingRoutes.post("/photos", asyncHandler(onboardingController.savePhotos));
onboardingRoutes.post(
  "/complete-onboarding",
  asyncHandler(onboardingController.completeOnboarding),
);
onboardingRoutes.get(
  "/me/profile",
  asyncHandler(onboardingController.getMeProfile),
);
