import { supabase } from "../supabase.js";
import { ApiError, dbApiError } from "../utils/apiError.js";
import { notificationService } from "../../backend/notifications/notificationService.js";
import { pushNotificationService } from "./pushNotificationService.js";
import { hasBlocked } from "./safetyService.js";

async function loadMatchForUser(userId, matchId) {
  const { data: match, error } = await supabase
    .from("matches")
    .select("id,user1_id,user2_id,status")
    .eq("id", matchId)
    .maybeSingle();

  if (error) throw dbApiError(500, "Unable to look up match", error);
  if (!match) throw new ApiError(404, "Match not found");
  if (match.user1_id !== userId && match.user2_id !== userId) {
    throw new ApiError(403, "You are not part of this match");
  }
  return match;
}

export async function listMatchMessages(userId, matchId, after) {
  const match = await loadMatchForUser(userId, matchId);
  const partnerId = match.user1_id === userId ? match.user2_id : match.user1_id;

  const [userHasBlockedPartner, partnerHasBlockedUser] = await Promise.all([
    hasBlocked(userId, partnerId),
    hasBlocked(partnerId, userId),
  ]);

  let query = supabase
    .from("match_messages")
    .select("id,match_id,sender_id,body,created_at,read_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });

  if (after) query = query.gt("created_at", after);

  const { data, error } = await query;
  if (error) throw dbApiError(500, "Unable to load messages", error);

  // If this user blocked the partner, the partner's messages never reach
  // them at all — filtered out before anything else sees them.
  const visible = userHasBlockedPartner
    ? (data || []).filter((m) => m.sender_id !== partnerId)
    : data || [];

  // Mark the partner's messages as read now that this user has fetched them.
  const unreadFromPartner = visible
    .filter((m) => m.sender_id !== userId && !m.read_at)
    .map((m) => m.id);

  if (unreadFromPartner.length > 0) {
    const nowIso = new Date().toISOString();
    await supabase.from("match_messages").update({ read_at: nowIso }).in("id", unreadFromPartner);
    for (const m of visible) {
      if (unreadFromPartner.includes(m.id)) m.read_at = nowIso;
    }
  }

  // Only messages this user sent TO a partner who has blocked them can ever
  // be "undelivered" — flagged here (not persisted) so the sender's own UI
  // can grey them out permanently without an explicit error or tipping them
  // off that they've been blocked.
  return visible.map((m) => ({
    ...m,
    undelivered: m.sender_id === userId && partnerHasBlockedUser,
  }));
}

export async function sendMatchMessage(userId, matchId, body) {
  const match = await loadMatchForUser(userId, matchId);
  const recipientId = match.user1_id === userId ? match.user2_id : match.user1_id;

  if (await hasBlocked(userId, recipientId)) {
    throw new ApiError(403, "You can't message this member.");
  }

  const { data: message, error } = await supabase
    .from("match_messages")
    .insert({ match_id: matchId, sender_id: userId, body })
    .select("id,match_id,sender_id,body,created_at,read_at")
    .single();

  if (error) throw dbApiError(500, "Unable to send message", error);

  // If the recipient has blocked this sender, the message is still saved
  // (so the sender's own thread looks normal) but never notified or truly
  // delivered — the sender isn't told, their bubble just stays "sending".
  const recipientHasBlockedSender = await hasBlocked(recipientId, userId);
  if (!recipientHasBlockedSender) {
    notifyRecipient(recipientId, userId, matchId, body).catch((err) => {
      console.error("Could not notify recipient of new match message:", err);
    });
  }

  return { ...message, undelivered: recipientHasBlockedSender };
}

async function notifyRecipient(recipientId, senderId, matchId, body) {
  const { data: sender } = await supabase
    .from("users")
    .select("name")
    .eq("id", senderId)
    .maybeSingle();

  const title = `${sender?.name || "Your match"} sent you a message`;
  const preview = body.length > 120 ? `${body.slice(0, 117)}...` : body;

  const notification = await notificationService.createNotification({
    user_id: recipientId,
    title,
    message: preview,
    type: "message",
    category: "match",
    metadata: { match_id: matchId },
    action_url: "/chats",
  });

  await pushNotificationService.sendToUsers([recipientId], {
    id: notification?.id,
    title,
    body: preview,
    url: "/chats",
  });
}
