import multer from "multer";
import { ApiError } from "../utils/apiError.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

function fileFilter(_req, file, cb) {
  if (!file?.mimetype?.startsWith("image/")) {
    cb(new ApiError(400, "Invalid file type (expected image/*)"));
    return;
  }
  cb(null, true);
}

export const uploadAnyImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter
}).any();

