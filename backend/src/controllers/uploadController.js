import { randomUUID } from "node:crypto";
import path from "node:path";
import { ApiError } from "../utils/apiError.js";
import { supabase } from "../supabase.js";

function safeExt(originalname) {
  const ext = path.extname(originalname || "").toLowerCase();
  if (!ext) return "";
  if (!/^\.[a-z0-9]+$/.test(ext)) return "";
  return ext;
}

export async function uploadUserPhoto(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const bucket = process.env.SUPABASE_USER_PHOTOS_BUCKET;
  if (!bucket) throw new Error("Missing SUPABASE_USER_PHOTOS_BUCKET");

  const file = Array.isArray(req.files) ? req.files[0] : null;
  if (!file) throw new ApiError(400, "Missing file");
  if (!file.mimetype?.startsWith("image/")) throw new ApiError(400, "Invalid file type (expected image/*)");

  const ext = safeExt(file.originalname) || "";
  const objectPath = `${userId}/${randomUUID()}${ext}`;

  const { error: uploadErr } = await supabase.storage.from(bucket).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: true
  });
  if (uploadErr) throw new ApiError(502, "Failed to upload image", { supabase: uploadErr.message });

  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  const publicUrl = publicData?.publicUrl;
  if (!publicUrl) throw new ApiError(502, "Failed to get public URL");

  res.status(201).json({ image_url: publicUrl, path: objectPath });
}

