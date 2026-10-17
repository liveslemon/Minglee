import { supabase } from "../supabase.js";
import { ApiError } from "../utils/apiError.js";

// Match statuses that are already finished; anything else is a live match.
const FINISHED_MATCH_STATUSES = ["expired", "cancelled"];

const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";

function dbError(error) {
  return new ApiError(400, "Database error", { message: error.message, details: error.details });
}

async function findOpenReport(reporterId, reportedUserId) {
  const { data, error } = await supabase
    .from("user_reports")
    .select("*")
    .eq("reporter_id", reporterId)
    .eq("reported_user_id", reportedUserId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (error) throw dbError(error);
  return data;
}

async function findBlock(blockerId, blockedId) {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("*")
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId)
    .maybeSingle();
  if (error) throw dbError(error);
  return data;
}

/**
 * Create a report, or return the reporter's existing open report on the same user.
 * IDs must already be validated as UUIDs.
 * @returns {Promise<{ report: object, created: boolean }>}
 */
export async function createReport(reporterId, { reported_user_id, reason, details }) {
  if (reporterId === reported_user_id) throw new ApiError(400, "You cannot report yourself");

  const existing = await findOpenReport(reporterId, reported_user_id);
  if (existing) return { report: existing, created: false };

  const { data, error } = await supabase
    .from("user_reports")
    .insert({
      reporter_id: reporterId,
      reported_user_id,
      reason,
      details: details || null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === PG_FOREIGN_KEY_VIOLATION) throw new ApiError(404, "User not found");
    if (error.code === PG_UNIQUE_VIOLATION) {
      // Lost a race with an identical concurrent report: return the one that won.
      const winner = await findOpenReport(reporterId, reported_user_id);
      if (winner) return { report: winner, created: false };
    }
    throw dbError(error);
  }

  return { report: data, created: true };
}

/**
 * Block a user (idempotent) and cancel any live match between the two users.
 * IDs must already be validated as UUIDs (they are interpolated into a filter).
 * @returns {Promise<{ block: object, created: boolean }>}
 */
export async function blockUser(blockerId, blockedId) {
  if (blockerId === blockedId) throw new ApiError(400, "You cannot block yourself");

  let block = await findBlock(blockerId, blockedId);
  let created = false;

  if (!block) {
    const { data, error } = await supabase
      .from("user_blocks")
      .insert({ blocker_id: blockerId, blocked_id: blockedId })
      .select("*")
      .single();

    if (error) {
      if (error.code === PG_FOREIGN_KEY_VIOLATION) throw new ApiError(404, "User not found");
      if (error.code !== PG_UNIQUE_VIOLATION) throw dbError(error);
      // Concurrent duplicate block: use the row that won.
      block = await findBlock(blockerId, blockedId);
      if (!block) throw dbError(error);
    } else {
      block = data;
      created = true;
    }
  }

  // Runs on every call, not just the first, so repeating a block also cleans up.
  const { error: matchErr } = await supabase
    .from("matches")
    .update({ status: "cancelled" })
    .or(
      `and(user1_id.eq.${blockerId},user2_id.eq.${blockedId}),` +
        `and(user1_id.eq.${blockedId},user2_id.eq.${blockerId})`,
    )
    .not("status", "in", `(${FINISHED_MATCH_STATUSES.join(",")})`);
  if (matchErr) throw dbError(matchErr);

  return { block, created };
}

/**
 * Open-report count and distinct reasons (newest first), keyed by reported user id.
 * @returns {Promise<Map<string, { count: number, reasons: string[] }>>}
 */
export async function getOpenReportSummary() {
  const { data, error } = await supabase
    .from("user_reports")
    .select("reported_user_id,reason,created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw dbError(error);

  const summary = new Map();
  for (const row of data ?? []) {
    const entry = summary.get(row.reported_user_id) ?? { count: 0, reasons: [] };
    entry.count += 1;
    if (!entry.reasons.includes(row.reason)) entry.reasons.push(row.reason);
    summary.set(row.reported_user_id, entry);
  }
  return summary;
}
