import { supabase } from "../supabase.js";
import { ApiError } from "../utils/apiError.js";
import { withSignedPhotoUrls } from "./photoUrls.js";

// Statuses that hide a match from both users.
const HIDDEN_STATUSES = ["expired", "cancelled"];

function dbError(error) {
  return new ApiError(400, "Database error", { message: error.message, details: error.details });
}

function inchesToCm(totalInches) {
  return totalInches == null ? undefined : Math.round(totalInches * 2.54);
}

export async function getCurrentMatch(userId) {
  const { data: match, error } = await supabase
    .from("matches")
    .select("id,user1_id,user2_id,match_score,match_week,status")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .not("status", "in", `(${HIDDEN_STATUSES.join(",")})`)
    .order("match_week", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw dbError(error);
  if (!match) return null;

  const partnerId = match.user1_id === userId ? match.user2_id : match.user1_id;

  const [
    { data: partner, error: userErr },
    { data: profile, error: profileErr },
    { data: photos, error: photoErr },
    { data: focuses, error: focusErr },
  ] = await Promise.all([
    supabase.from("users").select("id,name,whatsapp_number").eq("id", partnerId).maybeSingle(),
    supabase.from("user_profiles").select("*").eq("user_id", partnerId).maybeSingle(),
    supabase
      .from("user_photos")
      .select("image_url,photo_type,upload_order")
      .eq("user_id", partnerId)
      .order("upload_order", { ascending: true }),
    supabase.from("user_focuses").select("focus_option").eq("user_id", partnerId),
  ]);
  const anyErr = userErr || profileErr || photoErr || focusErr;
  if (anyErr) throw dbError(anyErr);
  if (!partner) return null;

  const signedPhotos = await withSignedPhotoUrls(photos, partnerId);

  return {
    match_id: match.id,
    match_score: match.match_score,
    match_week: match.match_week,
    status: match.status,
    partner: {
      id: partner.id,
      name: partner.name,
      whatsapp_number: partner.whatsapp_number,
      profile: profile
        ? {
            age: profile.age,
            height: inchesToCm(profile.height),
            build: profile.build,
            gender: profile.gender,
            skin_tone: profile.skin_tone,
            social_persona: profile.social_persona,
            weekend_type: profile.weekend_type,
            conflict_style: profile.conflict_style,
            relationship_goal: profile.relationship_goal,
            instagram: profile.instagram,
          }
        : {},
      photos: signedPhotos,
      focuses: (focuses ?? []).map((f) => f.focus_option),
    },
  };
}

// Save (or overwrite) the caller's rating of a match they were part of.
export async function submitMatchFeedback(userId, matchId, rating) {
  const { data: match, error } = await supabase
    .from("matches")
    .select("id,user1_id,user2_id")
    .eq("id", matchId)
    .maybeSingle();
  if (error) throw dbError(error);
  // Same response for "doesn't exist" and "not yours", so ids can't be probed.
  if (!match || (match.user1_id !== userId && match.user2_id !== userId)) {
    throw new ApiError(404, "Match not found");
  }

  const { data, error: saveErr } = await supabase
    .from("match_feedback")
    .upsert(
      { match_id: matchId, user_id: userId, rating, updated_at: new Date().toISOString() },
      { onConflict: "match_id,user_id" },
    )
    .select("match_id,rating,updated_at")
    .single();
  if (saveErr) throw dbError(saveErr);
  return data;
}
