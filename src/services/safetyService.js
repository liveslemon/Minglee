import { supabase } from "../supabase.js";
import { ApiError, dbApiError } from "../utils/apiError.js";

export async function reportUser(reporterId, reportedUserId, reason) {
  if (reporterId === reportedUserId) {
    throw new ApiError(400, "You can't report yourself");
  }

  const { data, error } = await supabase
    .from("reports")
    .insert({ reporter_id: reporterId, reported_user_id: reportedUserId, reason })
    .select("id,status")
    .single();

  if (error) throw dbApiError(500, "Unable to save report", error);
  return data;
}

export async function blockUser(blockerId, blockedId) {
  if (blockerId === blockedId) {
    throw new ApiError(400, "You can't block yourself");
  }

  const { data, error } = await supabase
    .from("user_blocks")
    .upsert(
      { blocker_id: blockerId, blocked_id: blockedId },
      { onConflict: "blocker_id,blocked_id" },
    )
    .select("id")
    .single();

  if (error) throw dbApiError(500, "Unable to block member", error);
  return data;
}

// Directional: true only if blockerId specifically blocked blockedId. Blocking
// protects the blocker — the blocked person isn't tipped off, so this is
// deliberately not symmetric like a "pair" check would be.
export async function hasBlocked(blockerId, blockedId) {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("id")
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId)
    .limit(1);

  if (error) throw dbApiError(500, "Unable to check block status", error);
  return (data || []).length > 0;
}
