import {
  focusesSchema,
  photosSchema,
  preferredBuildsSchema,
  preferencesSchema,
  profileSchema,
} from "../validators/onboardingSchemas.js";
import * as profileService from "../services/profileService.js";
import { ApiError } from "../utils/apiError.js";
import { supabase } from "../supabase.js";
import path from "path";
import { z } from "zod";

function toNumberOrValue(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? value : parsed;
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** Remove keys whose value is undefined so .strict() schemas don't see them */
function stripUndefined(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  );
}

function normalizePhotoType(value) {
  if (value === "Profile" || value === "Gallery") return value;
  if (typeof value !== "string") return value;
  const lowered = value.trim().toLowerCase();
  if (lowered === "profile") return "Profile";
  if (lowered === "gallery") return "Gallery";
  return value;
}

function normalizeCompleteOnboardingPayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const profile =
    body.profile && typeof body.profile === "object" ? body.profile : {};
  const preferences =
    body.preferences && typeof body.preferences === "object"
      ? body.preferences
      : undefined;

  // Only pick known profile fields — never spread raw input
  const normalizedProfile = stripUndefined({
    gender: normalizeOptionalText(profile.gender),
    age: toNumberOrValue(profile.age),
    height: toNumberOrValue(profile.height),
    build: normalizeOptionalText(profile.build),
    skin_tone: normalizeOptionalText(profile.skin_tone),
    personal_style: normalizeOptionalText(profile.personal_style),
    social_persona: normalizeOptionalText(profile.social_persona),
    weekend_type: normalizeOptionalText(profile.weekend_type),
    afternoon_activity: normalizeOptionalText(profile.afternoon_activity),
    habits: normalizeOptionalText(profile.habits),
    conflict_style: normalizeOptionalText(profile.conflict_style),
    relationship_goal: normalizeOptionalText(profile.relationship_goal),
    green_flag: normalizeOptionalText(profile.green_flag),
    instagram: normalizeOptionalText(profile.instagram),
    tiktok: normalizeOptionalText(profile.tiktok),
  });

  const normalizedPreferences = preferences
    ? stripUndefined({
        preferred_min_age: toNumberOrValue(preferences.preferred_min_age),
        preferred_max_age: toNumberOrValue(preferences.preferred_max_age),
        preferred_min_height: toNumberOrValue(preferences.preferred_min_height),
        preferred_max_height: toNumberOrValue(preferences.preferred_max_height),
      })
    : undefined;

  // If preferences ended up empty after stripping, treat as undefined
  const finalPreferences =
    normalizedPreferences && Object.keys(normalizedPreferences).length > 0
      ? normalizedPreferences
      : undefined;

  const rawPhotos = Array.isArray(body.photos) ? body.photos : body.photo_urls;
  const normalizedPhotos = Array.isArray(rawPhotos)
    ? rawPhotos.map((photo) => ({
        image_url: photo?.image_url,
        upload_order: toNumberOrValue(photo?.upload_order),
        photo_type: normalizePhotoType(photo?.photo_type),
      }))
    : rawPhotos;

  return stripUndefined({
    profile: normalizedProfile,
    preferences: finalPreferences,
    focuses:
      Array.isArray(body.focuses) && body.focuses.length > 0
        ? body.focuses
        : undefined,
    preferred_builds: (() => {
      const builds =
        body.preferred_builds ?? body.preferredBuilds ?? body.builds;
      return Array.isArray(builds) && builds.length > 0 ? builds : undefined;
    })(),
    photos: normalizedPhotos,
  });
}

// Schema for the atomic onboarding completion endpoint
// Uses non-strict profile/preferences to tolerate edge cases from the frontend
const profileSchemaLenient = z
  .object({
    gender: z.string().min(1).max(40).optional(),
    age: z.number().int().min(18).optional(),
    height: z.number().int().min(50).max(260).optional(),
    build: z
      .enum([
        "Slim",
        "Petite",
        "Athletic",
        "Average",
        "Muscular",
        "Curvy",
        "Plus-size",
      ])
      .optional(),
    skin_tone: z.string().min(1).max(60).optional(),
    personal_style: z.string().min(1).max(80).optional(),
    social_persona: z.string().min(1).max(80).optional(),
    weekend_type: z.string().min(1).max(80).optional(),
    afternoon_activity: z.string().min(1).max(80).optional(),
    habits: z.string().min(1).max(120).optional(),
    conflict_style: z.string().min(1).max(120).optional(),
    relationship_goal: z.string().min(1).max(120).optional(),
    green_flag: z.string().min(1).max(200).optional(),
    instagram: z.string().min(1).max(120).optional(),
    tiktok: z.string().min(1).max(120).optional(),
  })
  .passthrough();

const preferencesSchemaLenient = z
  .object({
    preferred_min_age: z.number().int().min(18).optional(),
    preferred_max_age: z.number().int().min(18).optional(),
    preferred_min_height: z.number().int().min(50).max(260).optional(),
    preferred_max_height: z.number().int().min(50).max(260).optional(),
  })
  .passthrough()
  .optional();

const completeOnboardingSchema = z.object({
  profile: profileSchemaLenient,
  preferences: preferencesSchemaLenient,
  focuses: z.array(z.string()).max(2).optional(),
  preferred_builds: z.array(z.string()).min(1).max(7).optional(),
  photos: z
    .array(
      z.object({
        image_url: z.string().url(),
        photo_type: z.enum(["Profile", "Gallery"]),
        upload_order: z.number().int().min(1).max(2),
      }),
    )
    .min(1)
    .max(2),
});

export async function upsertProfile(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const input = profileSchema.parse(req.body);
  const profile = await profileService.upsertProfile(userId, input);
  return res.status(201).json({
    profile: {
      gender: profile.gender ?? null,
      age: profile.age ?? null,
      height: profile.height ?? null,
      build: profile.build ?? null,
      skin_tone: profile.skin_tone ?? null,
      personal_style: profile.personal_style ?? null,
      social_persona: profile.social_persona ?? null,
      weekend_type: profile.weekend_type ?? null,
      afternoon_activity: profile.afternoon_activity ?? null,
      habits: profile.habits ?? null,
      conflict_style: profile.conflict_style ?? null,
      relationship_goal: profile.relationship_goal ?? null,
      green_flag: profile.green_flag ?? null,
      instagram: profile.instagram ?? null,
      tiktok: profile.tiktok ?? null,
    },
  });
}

export async function upsertPreferences(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const input = preferencesSchema.parse(req.body);
  const preferences = await profileService.upsertPreferences(userId, input);
  return res.status(201).json({
    preferences: {
      preferred_min_age: preferences.preferred_min_age ?? null,
      preferred_max_age: preferences.preferred_max_age ?? null,
      preferred_min_height: preferences.preferred_min_height ?? null,
      preferred_max_height: preferences.preferred_max_height ?? null,
    },
  });
}

export async function saveFocuses(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const input = focusesSchema.parse(req.body);
  const focuses = await profileService.replaceFocuses(userId, input.focuses);
  return res.status(201).json({ focuses: focuses.map((f) => f.focus) });
}

export async function savePreferredBuilds(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const input = preferredBuildsSchema.parse(req.body);
  const builds = await profileService.replacePreferredBuilds(
    userId,
    input.builds,
  );
  return res
    .status(201)
    .json({ preferred_builds: builds.map((b) => b.preferred_build) });
}

export async function savePhotos(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const input = photosSchema.parse(req.body);

  // Ensure upload_order is unique (1..3)
  const uploadOrders = input.photos.map((p) => p.upload_order);
  const unique = new Set(uploadOrders);
  if (unique.size !== uploadOrders.length) {
    throw new ApiError(400, "Invalid input", {
      upload_order: "upload_order must be unique per photo",
    });
  }

  const photos = await profileService.replacePhotos(userId, input.photos);
  return res.status(201).json({
    photos: photos.map((p) => ({
      image_url: p.image_url,
      photo_type: p.photo_type,
      upload_order: p.upload_order,
    })),
  });
}

export async function getMeProfile(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const data = await profileService.getMeProfile(userId);
  if (!data) throw new ApiError(404, "User not found");

  return res.json({
    user: {
      id: data.user.id,
      name: data.user.name,
      whatsapp_number: data.user.whatsapp_number,
      role: data.user.role,
      onboarding_completed: data.user.onboarding_completed,
      current_step: data.user.current_step,
      created_at: data.user.created_at,
      updated_at: data.user.updated_at,
    },
    profile: data.profile
      ? {
          gender: data.profile.gender,
          age: data.profile.age,
          height: data.profile.height,
          build: data.profile.build,
          skin_tone: data.profile.skin_tone,
          personal_style: data.profile.personal_style,
          social_persona: data.profile.social_persona,
          weekend_type: data.profile.weekend_type,
          afternoon_activity: data.profile.afternoon_activity,
          habits: data.profile.habits,
          conflict_style: data.profile.conflict_style,
          relationship_goal: data.profile.relationship_goal,
          green_flag: data.profile.green_flag,
          instagram: data.profile.instagram,
          tiktok: data.profile.tiktok,
        }
      : null,
    preferences: data.preferences
      ? {
          preferred_min_age: data.preferences.preferred_min_age,
          preferred_max_age: data.preferences.preferred_max_age,
          preferred_min_height: data.preferences.preferred_min_height,
          preferred_max_height: data.preferences.preferred_max_height,
        }
      : null,
    focuses: data.focuses.map((f) => f.focus_option),
    preferred_builds: data.builds.map((b) => b.preferred_build),
    photos: data.photos.map((p) => ({
      image_url: p.image_url,
      photo_type: p.photo_type,
      upload_order: p.upload_order,
    })),
  });
}

export async function uploadPhoto(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  if (!req.file) {
    throw new ApiError(400, "No file uploaded in request ('file' expected)");
  }

  // Validate mimetype server-side (defense in depth)
  const ALLOWED_IMAGE_MIMES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ];
  if (!ALLOWED_IMAGE_MIMES.includes(req.file.mimetype)) {
    throw new ApiError(
      400,
      "Only image files are allowed (JPEG, PNG, WebP, GIF)",
    );
  }

  // Enforce max 3 photos per user
  const { count, error: countErr } = await supabase
    .from("user_photos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countErr) throw new ApiError(500, "Failed to check existing photos");
  if ((count ?? 0) >= 2) {
    throw new ApiError(
      400,
      "Maximum of 2 photos allowed. Remove an existing photo first.",
    );
  }

  const bucketName = process.env.SUPABASE_USER_PHOTOS_BUCKET || "user-photos";
  const ext = path.extname(req.file.originalname) || ".jpg";
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const filePath = `${userId}/${timestamp}-${random}${ext}`;

  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(filePath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
    });

  if (error) {
    throw new ApiError(500, `Supabase Storage Error: ${error.message}`);
  }

  const { data: publicUrlData } = supabase.storage
    .from(bucketName)
    .getPublicUrl(filePath);

  return res.status(201).json({
    image_url: publicUrlData.publicUrl,
    path: filePath,
  });
}

/**
 * Atomic onboarding completion endpoint.
 * Saves all onboarding data in one request. If any step fails,
 * previously written data is rolled back so no partial state persists.
 */
export async function completeOnboarding(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const normalizedBody = normalizeCompleteOnboardingPayload(req.body);

  let input;
  try {
    input = completeOnboardingSchema.parse(normalizedBody);
  } catch (parseErr) {
    console.error(
      "[completeOnboarding] Validation failed:",
      JSON.stringify(parseErr.flatten?.() ?? parseErr.message, null, 2),
    );
    console.error(
      "[completeOnboarding] Normalized payload was:",
      JSON.stringify(normalizedBody, null, 2),
    );
    throw parseErr;
  }

  // Track what was written so we can rollback on failure
  const rollbackActions = [];

  try {
    // 1. Profile
    await profileService.upsertProfile(userId, input.profile);
    rollbackActions.push(async () => {
      await supabase.from("user_profiles").delete().eq("user_id", userId);
    });

    // 2. Preferences (optional)
    if (input.preferences) {
      await profileService.upsertPreferences(userId, input.preferences);
      rollbackActions.push(async () => {
        await supabase.from("preferences").delete().eq("user_id", userId);
      });
    }

    // 3. Focuses (optional)
    if (input.focuses && input.focuses.length > 0) {
      await profileService.replaceFocuses(userId, input.focuses);
      rollbackActions.push(async () => {
        await supabase.from("user_focuses").delete().eq("user_id", userId);
      });
    }

    // 4. Preferred Builds (optional)
    if (input.preferred_builds && input.preferred_builds.length > 0) {
      await profileService.replacePreferredBuilds(
        userId,
        input.preferred_builds,
      );
      rollbackActions.push(async () => {
        await supabase.from("preferred_builds").delete().eq("user_id", userId);
      });
    }

    // 5. Photos
    await profileService.replacePhotos(userId, input.photos);
    rollbackActions.push(async () => {
      await supabase.from("user_photos").delete().eq("user_id", userId);
    });

    // 6. Mark onboarding as completed
    const { error: updateErr } = await supabase
      .from("users")
      .update({ onboarding_completed: true, current_step: 7 })
      .eq("id", userId);

    if (updateErr)
      throw new ApiError(500, "Failed to mark onboarding complete");

    return res
      .status(201)
      .json({ success: true, message: "Onboarding completed successfully" });
  } catch (err) {
    // Rollback all previously written data (best-effort)
    for (const rollback of rollbackActions.reverse()) {
      try {
        await rollback();
      } catch (_) {
        /* best-effort cleanup */
      }
    }
    // Log the full error for debugging
    console.error(
      "[completeOnboarding] Error during save:",
      err.message,
      err.details ?? "",
    );
    // Re-throw the original error
    throw err;
  }
}
