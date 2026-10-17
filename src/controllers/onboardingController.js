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
import { config } from "../config.js";
import { signPhotoPaths } from "../services/photoUrls.js";
import path from "path";
import { z } from "zod";

const buildSchema = z.enum([
  "Slim",
  "Petite",
  "Athletic",
  "Average",
  "Muscular",
  "Curvy",
  "Plus-size",
]);

const conflictStyleSchema = z.enum([
  "Talk it out immediately",
  "Need space then talk",
  "Let it blow over",
]);

const relationshipGoalSchema = z.enum([
  "Marriage bound",
  "Long-term",
  "Short-term",
  "Just looking for fun",
]);

/** Convert { feet, inches } object, string, or legacy number to total inches for DB storage */
function heightToInches(h) {
  if (h == null) return undefined;
  if (typeof h === "object" && h.feet != null)
    return h.feet * 12 + (h.inches || 0);
  if (typeof h === "string") {
    const n = Number(h.trim());
    return Number.isNaN(n) ? undefined : n;
  }
  return h;
}

/** Convert DB total-inches integer to { feet, inches } for API responses */
function inchesToHeight(totalInches) {
  if (totalInches == null) return null;
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

function toNumberOrValue(value) {
  if (value == null) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? value : parsed;
}

function normalizeOptionalText(value) {
  if (value == null) return undefined;
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
    height: heightToInches(profile.height),
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
        preferred_min_height: heightToInches(preferences.preferred_min_height),
        preferred_max_height: heightToInches(preferences.preferred_max_height),
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

function normalizeProfilePayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};

  return stripUndefined({
    gender: normalizeOptionalText(body.gender),
    age: toNumberOrValue(body.age),
    height: heightToInches(body.height),
    build: normalizeOptionalText(body.build),
    skin_tone: normalizeOptionalText(body.skin_tone),
    personal_style: normalizeOptionalText(body.personal_style),
    social_persona: normalizeOptionalText(body.social_persona),
    weekend_type: normalizeOptionalText(body.weekend_type),
    afternoon_activity: normalizeOptionalText(body.afternoon_activity),
    habits: normalizeOptionalText(body.habits),
    conflict_style: normalizeOptionalText(body.conflict_style),
    relationship_goal: normalizeOptionalText(body.relationship_goal),
    green_flag: normalizeOptionalText(body.green_flag),
    instagram: normalizeOptionalText(body.instagram),
    tiktok: normalizeOptionalText(body.tiktok),
  });
}

function normalizePreferencesPayload(payload) {
  const body = payload && typeof payload === "object" ? payload : {};

  return stripUndefined({
    preferred_min_age: toNumberOrValue(body.preferred_min_age),
    preferred_max_age: toNumberOrValue(body.preferred_max_age),
    preferred_min_height: heightToInches(body.preferred_min_height),
    preferred_max_height: heightToInches(body.preferred_max_height),
  });
}

// Schema for the atomic onboarding completion endpoint
// Uses non-strict profile/preferences to tolerate edge cases from the frontend
const profileSchemaLenient = z
  .object({
    gender: z.string().min(1).max(40).optional(),
    age: z.number().int().min(18).optional(),
    height: z.number().int().min(36).max(96).optional(),
    build: buildSchema.optional(),
    skin_tone: z.string().min(1).max(60).optional(),
    personal_style: z.string().min(1).max(80).optional(),
    social_persona: z.string().min(1).max(80).optional(),
    weekend_type: z.string().min(1).max(80).optional(),
    afternoon_activity: z.string().min(1).max(80).optional(),
    habits: z.string().min(1).max(120).optional(),
    conflict_style: conflictStyleSchema.optional(),
    relationship_goal: relationshipGoalSchema.optional(),
    green_flag: z.string().min(1).max(200).optional(),
    instagram: z.string().min(1).max(120).optional(),
    tiktok: z.string().min(1).max(120).optional(),
  })
  .passthrough();

const preferencesSchemaLenient = z
  .object({
    preferred_min_age: z.number().int().min(18).optional(),
    preferred_max_age: z.number().int().min(18).optional(),
    preferred_min_height: z.number().int().min(36).max(96).optional(),
    preferred_max_height: z.number().int().min(36).max(96).optional(),
  })
  .passthrough()
  .optional();

const completeOnboardingSchema = z.object({
  profile: profileSchemaLenient,
  preferences: preferencesSchemaLenient,
  focuses: z.array(z.string()).max(2).optional(),
  preferred_builds: z.array(buildSchema).min(1).max(7).optional(),
  photos: z
    .array(
      z.object({
        // Object path or a URL from /photos/upload; replacePhotos validates
        // that it is in the user's own folder.
        image_url: z.string().min(1),
        photo_type: z.enum(["Profile", "Gallery"]),
        upload_order: z.number().int().min(1).max(2),
      }),
    )
    .max(2)
    .optional(),
});

const matchingPreferenceSchema = z
  .object({ ready_to_be_matched: z.boolean() })
  .strict();

export async function upsertProfile(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const input = profileSchema.parse(normalizeProfilePayload(req.body));
  const profile = await profileService.upsertProfile(userId, input);
  return res.status(201).json({
    profile: {
      gender: profile.gender ?? null,
      age: profile.age ?? null,
      height: inchesToHeight(profile.height),
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

  const input = preferencesSchema.parse(normalizePreferencesPayload(req.body));
  const preferences = await profileService.upsertPreferences(userId, input);
  return res.status(201).json({
    preferences: {
      preferred_min_age: preferences.preferred_min_age ?? null,
      preferred_max_age: preferences.preferred_max_age ?? null,
      preferred_min_height: inchesToHeight(preferences.preferred_min_height),
      preferred_max_height: inchesToHeight(preferences.preferred_max_height),
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
      ready_to_be_matched: data.user.ready_to_be_matched,
      onboarding_completed: data.user.onboarding_completed,
      current_step: data.user.current_step,
      created_at: data.user.created_at,
      updated_at: data.user.updated_at,
    },
    profile: data.profile
      ? {
          gender: data.profile.gender,
          age: data.profile.age,
          height: inchesToHeight(data.profile.height),
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
          preferred_min_height: inchesToHeight(
            data.preferences.preferred_min_height,
          ),
          preferred_max_height: inchesToHeight(
            data.preferences.preferred_max_height,
          ),
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

export async function updateMatchingPreference(req, res) {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, "Unauthorized");

  const input = matchingPreferenceSchema.parse(req.body);
  const preference = await profileService.updateMatchingPreference(
    userId,
    input.ready_to_be_matched,
  );
  return res.json(preference);
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

  const bucketName = config.userPhotosBucket;
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

  // The bucket is private: hand back a short-lived signed URL for preview.
  const signed = await signPhotoPaths([filePath]);

  return res.status(201).json({
    image_url: signed.get(filePath),
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
    // 1. Profile — convert height object to inches for DB
    const profileForDb = { ...input.profile };
    if (profileForDb.height != null)
      profileForDb.height = heightToInches(profileForDb.height);
    await profileService.upsertProfile(userId, profileForDb);
    rollbackActions.push(async () => {
      await supabase.from("user_profiles").delete().eq("user_id", userId);
    });

    // 2. Preferences (optional) — convert height objects to inches for DB
    if (input.preferences) {
      const prefsForDb = { ...input.preferences };
      if (prefsForDb.preferred_min_height != null)
        prefsForDb.preferred_min_height = heightToInches(
          prefsForDb.preferred_min_height,
        );
      if (prefsForDb.preferred_max_height != null)
        prefsForDb.preferred_max_height = heightToInches(
          prefsForDb.preferred_max_height,
        );
      await profileService.upsertPreferences(userId, prefsForDb);
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

    // 5. Photos (optional)
    if (input.photos && input.photos.length > 0) {
      await profileService.replacePhotos(userId, input.photos);
      rollbackActions.push(async () => {
        await supabase.from("user_photos").delete().eq("user_id", userId);
      });
    }

    await profileService.refreshOnboardingCompletion(userId);

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
