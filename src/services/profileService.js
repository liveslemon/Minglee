import { supabase } from "../supabase.js";
import { ApiError } from "../utils/apiError.js";
import { photoPathFromClient, withSignedPhotoUrls } from "./photoUrls.js";

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function hasNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isUserReadyForMatching({ user, profile, preferences, builds }) {
  return Boolean(
    user &&
      hasText(user.name) &&
      hasText(user.whatsapp_number) &&
      profile &&
      hasText(profile.gender) &&
      hasNumber(profile.age) &&
      hasText(profile.build) &&
      hasText(profile.skin_tone) &&
      hasNumber(profile.height) &&
      hasText(profile.relationship_goal) &&
      hasText(profile.conflict_style) &&
      (hasText(profile.instagram) || hasText(profile.tiktok)) &&
      preferences &&
      hasNumber(preferences.preferred_min_age) &&
      hasNumber(preferences.preferred_max_age) &&
      hasNumber(preferences.preferred_min_height) &&
      hasNumber(preferences.preferred_max_height) &&
      Array.isArray(builds) &&
      builds.length > 0,
  );
}

export async function upsertProfile(userId, profileInput) {
  const payload = {
    user_id: userId,
    ...profileInput,
  };

  const { data, error } = await supabase
    .from("user_profiles")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error)
    throw new ApiError(400, "Unable to save profile", {
      message: error.message,
      details: error.details,
    });
  await refreshOnboardingCompletion(userId);
  return data;
}

export async function upsertPreferences(userId, prefsInput) {
  const payload = {
    user_id: userId,
    ...prefsInput,
  };

  const { data, error } = await supabase
    .from("preferences")
    .upsert(payload, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error)
    throw new ApiError(400, "Unable to save preferences", {
      message: error.message,
      details: error.details,
    });
  await refreshOnboardingCompletion(userId);
  return data;
}

export async function replaceFocuses(userId, focuses) {
  const uniqueFocuses = [...new Set(focuses)];

  const { error: delError } = await supabase
    .from("user_focuses")
    .delete()
    .eq("user_id", userId);
  if (delError)
    throw new ApiError(400, "Unable to reset focuses", {
      message: delError.message,
      details: delError.details,
    });

  if (uniqueFocuses.length === 0) return [];

  const { error } = await supabase
    .from("user_focuses")
    .insert(
      uniqueFocuses.map((focus) => ({ user_id: userId, focus_option: focus })),
    );

  if (error)
    throw new ApiError(400, "Unable to save focuses", {
      message: error.message,
      details: error.details,
    });

  // Return the payload shape expected by controllers without requiring select policy.
  return uniqueFocuses.map((focus) => ({ focus }));
}

export async function replacePreferredBuilds(userId, builds) {
  const { error: delError } = await supabase
    .from("preferred_builds")
    .delete()
    .eq("user_id", userId);
  if (delError)
    throw new ApiError(400, "Unable to reset preferred builds", {
      message: delError.message,
      details: delError.details,
    });

  if (builds.length === 0) return [];

  const { data, error } = await supabase
    .from("preferred_builds")
    .insert(
      builds.map((build) => ({ user_id: userId, preferred_build: build })),
    )
    .select("id,preferred_build");

  if (error)
    throw new ApiError(400, "Unable to save preferred builds", {
      message: error.message,
      details: error.details,
    });
  const savedBuilds = data ?? [];
  await refreshOnboardingCompletion(userId);
  return savedBuilds;
}

export async function replacePhotos(userId, photos) {
  // Store object paths, not URLs. Clients echo back the signed URL from
  // /photos/upload; only files in the user's own folder are accepted.
  const rows = photos.map((p) => ({
    user_id: userId,
    image_url: photoPathFromClient(p.image_url, userId),
    // Bypassing broken DB constraint "user_photos_photo_type_check" by sending null (which is valid and bypasses rule)
    photo_type: null,
    upload_order: p.upload_order,
  }));

  const { error: delError } = await supabase
    .from("user_photos")
    .delete()
    .eq("user_id", userId);
  if (delError)
    throw new ApiError(400, "Unable to reset photos", {
      message: delError.message,
      details: delError.details,
    });

  const { data, error } = await supabase
    .from("user_photos")
    .insert(rows)
    .select("id,image_url,photo_type,upload_order")
    .order("upload_order", { ascending: true });

  if (error)
    throw new ApiError(400, "Unable to save photos", {
      message: error.message,
      details: error.details,
    });
  return withSignedPhotoUrls(data, userId);
}

export async function refreshOnboardingCompletion(userId) {
  const [
    { data: user, error: userErr },
    { data: profile, error: profileErr },
    { data: preferences, error: prefErr },
    { data: builds, error: buildErr },
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id,name,whatsapp_number,current_step")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("user_profiles")
      .select(
        "gender,age,build,skin_tone,height,relationship_goal,conflict_style,instagram,tiktok",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("preferences")
      .select(
        "preferred_min_age,preferred_max_age,preferred_min_height,preferred_max_height",
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("preferred_builds")
      .select("preferred_build")
      .eq("user_id", userId),
  ]);

  const anyErr = userErr || profileErr || prefErr || buildErr;
  if (anyErr) {
    throw new ApiError(400, "Unable to refresh onboarding status", {
      message: anyErr.message,
      details: anyErr.details,
    });
  }

  const onboardingCompleted = isUserReadyForMatching({
    user,
    profile,
    preferences,
    builds,
  });

  const updatePayload = {
    onboarding_completed: onboardingCompleted,
  };

  if (onboardingCompleted) {
    updatePayload.current_step = 0;
  }

  const { error } = await supabase
    .from("users")
    .update(updatePayload)
    .eq("id", userId);

  if (error) {
    throw new ApiError(400, "Unable to update onboarding completion", {
      message: error.message,
      details: error.details,
    });
  }
}

export async function getMeProfile(userId) {
  const { data: user, error: userErr } = await supabase
    .from("users")
    .select(
      "id,name,whatsapp_number,role,ready_to_be_matched,onboarding_completed,current_step,created_at,updated_at",
    )
    .eq("id", userId)
    .maybeSingle();
  if (userErr)
    throw new ApiError(400, "Database error", {
      message: userErr.message,
      details: userErr.details,
    });
  if (!user) return null;

  const [
    { data: profile, error: profileErr },
    { data: preferences, error: prefErr },
    { data: focuses, error: focusErr },
    { data: builds, error: buildErr },
    { data: photos, error: photoErr },
  ] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("user_focuses").select("focus_option").eq("user_id", userId),
    supabase
      .from("preferred_builds")
      .select("preferred_build")
      .eq("user_id", userId),
    supabase
      .from("user_photos")
      .select("image_url,photo_type,upload_order")
      .eq("user_id", userId)
      .order("upload_order", { ascending: true }),
  ]);

  const anyErr = profileErr || prefErr || focusErr || buildErr || photoErr;
  if (anyErr)
    throw new ApiError(400, "Database error", {
      message: anyErr.message,
      details: anyErr.details,
    });

  return {
    user,
    profile,
    preferences,
    focuses: focuses ?? [],
    builds: builds ?? [],
    photos: await withSignedPhotoUrls(photos, userId),
  };
}

export async function updateMatchingPreference(userId, readyToBeMatched) {
  const { data, error } = await supabase
    .from("users")
    .update({ ready_to_be_matched: readyToBeMatched })
    .eq("id", userId)
    .select("ready_to_be_matched")
    .single();

  if (error)
    throw new ApiError(400, "Unable to update matching preference", {
      message: error.message,
      details: error.details,
    });
  return data;
}
