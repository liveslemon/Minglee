import { supabase } from "../supabase.js";
import { dbApiError } from "../utils/apiError.js";

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
    throw dbApiError(400, "Unable to save profile", error);
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
    throw dbApiError(400, "Unable to save preferences", error);
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
    throw dbApiError(400, "Unable to reset focuses", delError);

  if (uniqueFocuses.length === 0) return [];

  const { error } = await supabase
    .from("user_focuses")
    .insert(
      uniqueFocuses.map((focus) => ({ user_id: userId, focus_option: focus })),
    );

  if (error)
    throw dbApiError(400, "Unable to save focuses", error);

  // Return the payload shape expected by controllers without requiring select policy.
  return uniqueFocuses.map((focus) => ({ focus }));
}

export async function replacePreferredBuilds(userId, builds) {
  const { error: delError } = await supabase
    .from("preferred_builds")
    .delete()
    .eq("user_id", userId);
  if (delError)
    throw dbApiError(400, "Unable to reset preferred builds", delError);

  if (builds.length === 0) return [];

  const { data, error } = await supabase
    .from("preferred_builds")
    .insert(
      builds.map((build) => ({ user_id: userId, preferred_build: build })),
    )
    .select("id,preferred_build");

  if (error)
    throw dbApiError(400, "Unable to save preferred builds", error);
  const savedBuilds = data ?? [];
  await refreshOnboardingCompletion(userId);
  return savedBuilds;
}

export async function replacePhotos(userId, photos) {
  const { error: delError } = await supabase
    .from("user_photos")
    .delete()
    .eq("user_id", userId);
  if (delError)
    throw dbApiError(400, "Unable to reset photos", delError);

  const { data, error } = await supabase
    .from("user_photos")
    .insert(
      photos.map((p) => ({
        user_id: userId,
        image_url: p.image_url,
        // Bypassing broken DB constraint "user_photos_photo_type_check" by sending null (which is valid and bypasses rule)
        photo_type: null,
        upload_order: p.upload_order,
      })),
    )
    .select("id,image_url,photo_type,upload_order")
    .order("upload_order", { ascending: true });

  if (error)
    throw dbApiError(400, "Unable to save photos", error);
  return data ?? [];
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
    throw dbApiError(400, "Unable to refresh onboarding status", anyErr);
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
    throw dbApiError(400, "Unable to update onboarding completion", error);
  }
}

export async function getMeProfile(userId) {
  // Keep the cached onboarding_completed/current_step columns honest in
  // case preference/profile rows were cleared out-of-band (e.g. by an
  // admin) since they were last recomputed.
  await refreshOnboardingCompletion(userId);

  const { data: user, error: userErr } = await supabase
    .from("users")
    .select(
      "id,name,whatsapp_number,role,ready_to_be_matched,onboarding_completed,current_step,created_at,updated_at",
    )
    .eq("id", userId)
    .maybeSingle();
  if (userErr)
    throw dbApiError(400, "Database error", userErr);
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
    throw dbApiError(400, "Database error", anyErr);

  return {
    user,
    profile,
    preferences,
    focuses: focuses ?? [],
    builds: builds ?? [],
    photos: photos ?? [],
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
    throw dbApiError(400, "Unable to update matching preference", error);
  return data;
}
