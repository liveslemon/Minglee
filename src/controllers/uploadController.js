import { randomUUID } from "node:crypto";
import path from "node:path";
import { ApiError } from "../utils/apiError.js";
import { supabase } from "../supabase.js";
import { config } from "../config.js";
import { signPhotoPaths } from "../services/photoUrls.js";

function safeExt(originalname) {
  const ext = path.extname(originalname || "").toLowerCase();
  if (!ext) return "";
  if (!/^\.[a-z0-9]+$/.test(ext)) return "";
  return ext;
}

export async function uploadUserPhoto(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const bucket = config.userPhotosBucket;

  const file = Array.isArray(req.files) ? req.files[0] : null;
  if (!file) throw new ApiError(400, "Missing file");
  if (!file.mimetype?.startsWith("image/")) throw new ApiError(400, "Invalid file type (expected image/*)");

  // Strictly enforce only 2 images limit
  const { count, error: countErr } = await supabase
    .from("user_photos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (!countErr && (count ?? 0) >= 2) {
    throw new ApiError(400, "Maximum of 2 images allowed. Only 2 photos can be uploaded.");
  }

  const ext = safeExt(file.originalname) || "";
  const objectPath = `${userId}/${randomUUID()}${ext}`;

  const { error: uploadErr } = await supabase.storage.from(bucket).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: true
  });
  if (uploadErr) throw new ApiError(502, "Failed to upload image", { supabase: uploadErr.message });

  // The bucket is private: hand back a short-lived signed URL for preview.
  const signed = await signPhotoPaths([objectPath]);

  res.status(201).json({ image_url: signed.get(objectPath), path: objectPath });
}

