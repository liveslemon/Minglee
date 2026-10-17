import { config } from "../config.js";
import { supabase } from "../supabase.js";
import { ApiError } from "../utils/apiError.js";

// User photos live in a private bucket. The DB stores the storage object path
// ("<userId>/<file>") and clients only ever see short-lived signed URLs.
export const PHOTO_URL_TTL_SECONDS = 60 * 60;

function storagePrefixes() {
  const base = `/storage/v1/object`;
  const bucket = config.userPhotosBucket;
  // Legacy rows hold public URLs; clients may echo back signed URLs we issued.
  return [`${base}/public/${bucket}/`, `${base}/sign/${bucket}/`];
}

function supabaseOrigin() {
  return new URL(config.supabaseUrl).origin;
}

function rawPathFromUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== supabaseOrigin()) return null;

  const prefix = storagePrefixes().find((p) => url.pathname.startsWith(p));
  if (!prefix) return null;

  try {
    return url.pathname
      .slice(prefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}

/**
 * Normalize a photo reference (object path, signed URL or legacy public URL)
 * to its storage object path. Returns null unless it points at a single file
 * directly inside `ownerId`'s own folder of the user photos bucket.
 */
export function extractPhotoPath(value, ownerId) {
  if (typeof value !== "string" || !ownerId) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const objectPath = /^https?:\/\//i.test(trimmed) ? rawPathFromUrl(trimmed) : trimmed;
  if (objectPath == null) return null;

  const segments = objectPath.split("/");
  if (segments.length !== 2) return null;
  const [folder, file] = segments;
  if (folder !== ownerId) return null;
  if (file === "" || file === "." || file === "..") return null;
  if (/[\\\u0000-\u001f\u007f]/.test(file)) return null;
  return objectPath;
}

/** Path to store for a photo the client submitted; 400 if it isn't the user's own. */
export function photoPathFromClient(value, userId) {
  const objectPath = extractPhotoPath(value, userId);
  if (!objectPath) {
    throw new ApiError(400, "Invalid input", {
      image_url: "image_url must be a photo you uploaded via /photos/upload",
    });
  }
  return objectPath;
}

/**
 * Map of object path -> signed URL, created in one batch request. Paths that
 * Storage can't sign (e.g. the file was deleted) are logged and left out, so one
 * broken photo doesn't take down a whole profile or match reveal.
 */
export async function signPhotoPaths(paths) {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase.storage
    .from(config.userPhotosBucket)
    .createSignedUrls(unique, PHOTO_URL_TTL_SECONDS);
  if (error) throw new ApiError(502, "Failed to sign photo URLs", { storage: error.message });

  const signed = new Map();
  for (const item of data ?? []) {
    if (item.error || !item.signedUrl) {
      console.error(`Could not sign photo "${item.path}":`, item.error);
      continue;
    }
    signed.set(item.path, item.signedUrl);
  }
  return signed;
}

/**
 * Replace each row's stored `image_url` (path or legacy public URL) with a
 * signed URL. Rows that don't point into `ownerId`'s folder, or can't be
 * signed, are logged and omitted.
 */
export async function withSignedPhotoUrls(rows, ownerId) {
  const entries = [];
  for (const row of rows ?? []) {
    const objectPath = extractPhotoPath(row.image_url, ownerId);
    if (objectPath) {
      entries.push({ row, objectPath });
    } else {
      console.error(
        `Stored photo reference for user ${ownerId} is not a file in their folder of bucket "${config.userPhotosBucket}": ${row.image_url}`,
      );
    }
  }

  const signed = await signPhotoPaths(entries.map((e) => e.objectPath));
  return entries
    .filter((e) => signed.has(e.objectPath))
    .map((e) => ({ ...e.row, image_url: signed.get(e.objectPath) }));
}
