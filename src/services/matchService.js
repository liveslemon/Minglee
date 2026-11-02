import { supabase } from "../supabase.js";
import { ApiError, dbApiError } from "../utils/apiError.js";
import { hasBlocked } from "./safetyService.js";

async function buildPartner(partnerId, { blocked } = {}) {
  const [
    { data: user, error: userErr },
    { data: profile, error: profileErr },
    { data: photos, error: photosErr },
    { data: focuses, error: focusErr },
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id,name,whatsapp_number")
      .eq("id", partnerId)
      .maybeSingle(),
    supabase.from("user_profiles").select("*").eq("user_id", partnerId).maybeSingle(),
    supabase
      .from("user_photos")
      .select("image_url,photo_type,upload_order")
      .eq("user_id", partnerId)
      .order("upload_order", { ascending: true }),
    supabase.from("user_focuses").select("focus_option").eq("user_id", partnerId),
  ]);

  const anyErr = userErr || profileErr || photosErr || focusErr;
  if (anyErr) throw dbApiError(500, "Unable to load match partner", anyErr);
  if (!user) return null;

  return {
    id: user.id,
    name: user.name,
    // Withheld only from the person who did the blocking — they no longer
    // want to see/reach this partner. The blocked person isn't tipped off,
    // so they keep seeing the partner's profile normally.
    whatsapp_number: blocked ? null : user.whatsapp_number,
    profile: {
      age: profile?.age ?? undefined,
      height: profile?.height ?? undefined,
      build: profile?.build ?? undefined,
      gender: profile?.gender ?? undefined,
      skin_tone: profile?.skin_tone ?? undefined,
      social_persona: profile?.social_persona ?? undefined,
      weekend_type: profile?.weekend_type ?? undefined,
      conflict_style: profile?.conflict_style ?? undefined,
      relationship_goal: profile?.relationship_goal ?? undefined,
      instagram: profile?.instagram ?? undefined,
    },
    photos: blocked
      ? []
      : (photos || []).map((p) => ({
          image_url: p.image_url,
          photo_type: p.photo_type,
          upload_order: p.upload_order,
        })),
    focuses: (focuses || []).map((f) => f.focus_option),
  };
}

export async function getCurrentMatchForUser(userId) {
  const { data: match, error } = await supabase
    .from("matches")
    .select("id,user1_id,user2_id,match_score,match_week,status,created_at")
    .eq("status", "pending")
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw dbApiError(500, "Unable to fetch current match", error);
  if (!match) return null;

  const partnerId = match.user1_id === userId ? match.user2_id : match.user1_id;
  const blocked = await hasBlocked(userId, partnerId);
  const partner = await buildPartner(partnerId, { blocked });
  if (!partner) return null;

  return {
    match_id: match.id,
    match_score: match.match_score,
    match_week: match.match_week,
    status: match.status,
    blocked,
    partner,
  };
}

export async function submitMatchFeedback(userId, matchId, rating) {
  const { data: match, error: matchErr } = await supabase
    .from("matches")
    .select("id,user1_id,user2_id")
    .eq("id", matchId)
    .maybeSingle();

  if (matchErr) throw dbApiError(500, "Unable to look up match", matchErr);
  if (!match) throw new ApiError(404, "Match not found");
  if (match.user1_id !== userId && match.user2_id !== userId) {
    throw new ApiError(403, "You are not part of this match");
  }

  const { data, error } = await supabase
    .from("match_feedback")
    .upsert(
      { match_id: matchId, user_id: userId, rating },
      { onConflict: "match_id,user_id" },
    )
    .select("id,rating")
    .single();

  if (error) throw dbApiError(500, "Unable to save feedback", error);
  return data;
}
