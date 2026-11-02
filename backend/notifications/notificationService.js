import { supabase } from "../../src/supabase.js";
import crypto from "crypto";
import { ApiError } from "../../src/utils/apiError.js";

const inMemoryNotifications = new Map();

function isTableNotFoundError(error) {
  return error && (
    error.code === "PGRST205" || 
    error.code === "PGRST204" || 
    error.code === "42P01" || 
    error.code === "42703" || 
    (error.message && (error.message.includes("schema cache") || error.message.includes("does not exist")))
  );
}

export const notificationService = {
  async savePushSubscription(userId, subscription, userAgent) {
    const payload = {
      user_id: userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      expiration_time: subscription.expirationTime ?? null,
      user_agent: userAgent || null,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from("push_subscriptions")
      .upsert(payload, { onConflict: "endpoint" })
      .select("id, user_id, endpoint, expiration_time, created_at, updated_at")
      .single();

    if (error) {
      if (
        error.code === "PGRST205" ||
        error.code === "42P01" ||
        error.message?.includes("push_subscriptions")
      ) {
        throw new ApiError(
          503,
          "Push subscription storage is not configured. Apply the push_subscriptions table from backend/schema.sql in the Supabase SQL Editor."
        );
      }
      throw error;
    }
    return data;
  },

  async createNotification(data) {
    const payload = {
      user_id: data.user_id,
      message: data.message,
      title: data.title || "Notification",
      type: data.type || "notification",
      category: data.category || "info",
      is_read: false,
      is_dismissed: data.is_dismissed ?? false,
      expires_at: data.expires_at || null,
      metadata: data.metadata || {},
      action_url: data.action_url || null
    };

    console.log("[NotificationService] Attempting to insert into Supabase 'notifications' table...", payload);

    try {
      const { data: notification, error } = await supabase
        .from("notifications")
        .insert([payload])
        .select()
        .single();

      if (error) {
        console.warn("[NotificationService] Supabase insert error:", error);
        if (isTableNotFoundError(error)) {
          console.log("[NotificationService] Column or table mismatch in Supabase schema cache. Using fallback store.");
          return this._createNotificationFallback(payload);
        }
        throw error;
      }

      console.log("[NotificationService] Supabase insert successful:", notification);
      return notification;
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._createNotificationFallback(payload);
      }
      throw err;
    }
  },

  _createNotificationFallback(data) {
    const notif = {
      id: crypto.randomUUID(),
      user_id: data.user_id,
      message: data.message,
      title: data.title || "Notification",
      type: data.type || "notification",
      category: data.category || "info",
      is_read: false,
      is_dismissed: data.is_dismissed ?? false,
      expires_at: data.expires_at || null,
      read_at: null,
      metadata: data.metadata || {},
      action_url: data.action_url || null,
      created_at: new Date().toISOString()
    };
    inMemoryNotifications.set(notif.id, notif);
    return notif;
  },

  async triggerBroadcast(data) {
    const { user_ids, message, title, type, category, expires_at, metadata, action_url } = data;
    try {
      const notificationsToInsert = user_ids.map(userId => ({
        user_id: userId,
        message,
        title: title || "Notification",
        type: type || "notification",
        category: category || "info",
        is_read: false,
        is_dismissed: false,
        expires_at: expires_at || null,
        metadata: metadata || {},
        action_url: action_url || null
      }));

      const { data: inserted, error } = await supabase
        .from("notifications")
        .insert(notificationsToInsert)
        .select();

      if (error) {
        if (isTableNotFoundError(error)) {
          return user_ids.map(uid => this._createNotificationFallback({ user_id: uid, message, title, type, category, expires_at, metadata, action_url }));
        }
        throw error;
      }
      return inserted;
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return user_ids.map(uid => this._createNotificationFallback({ user_id: uid, message, title, type, category, expires_at, metadata, action_url }));
      }
      throw err;
    }
  },

  // GET /notifications (Fetches standard notifications filtered by expiry)
  async getUserNotifications(userId, limit = 50, offset = 0) {
    const now = new Date().toISOString();
    console.log(`[NotificationService] Fetching notifications for user_id '${userId}'...`);
    try {
      let query = supabase
        .from("notifications")
        .select("*", { count: "exact" })
        .eq("user_id", userId)
        .neq("type", "popup")
        .or(`expires_at.is.null,expires_at.gte.${now}`)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      const { data: notifications, error, count } = await query;

      if (error) {
        if (isTableNotFoundError(error)) {
          return this._getUserNotificationsFallback(userId, limit, offset, now);
        }
        throw error;
      }

      const { count: unreadCount, error: countErr } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .neq("type", "popup")
        .eq("is_read", false)
        .or(`expires_at.is.null,expires_at.gte.${now}`);

      if (countErr) throw countErr;

      return {
        notifications,
        total: count,
        unreadCount: unreadCount || 0
      };
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._getUserNotificationsFallback(userId, limit, offset, now);
      }
      throw err;
    }
  },

  _getUserNotificationsFallback(userId, limit, offset, now = new Date().toISOString()) {
    const userNotifs = Array.from(inMemoryNotifications.values())
      .filter(n => n.user_id === userId && n.type !== "popup" && (!n.expires_at || n.expires_at >= now))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const paged = userNotifs.slice(offset, offset + limit);
    const unreadCount = userNotifs.filter(n => !n.is_read).length;

    return {
      notifications: paged,
      total: userNotifs.length,
      unreadCount
    };
  },

  // GET /notifications/unread
  async getUnreadNotifications(userId) {
    const now = new Date().toISOString();
    try {
      const { data: notifications, error, count } = await supabase
        .from("notifications")
        .select("*", { count: "exact" })
        .eq("user_id", userId)
        .neq("type", "popup")
        .eq("is_read", false)
        .or(`expires_at.is.null,expires_at.gte.${now}`)
        .order("created_at", { ascending: false });

      if (error) {
        if (isTableNotFoundError(error)) {
          return this._getUnreadNotificationsFallback(userId, now);
        }
        throw error;
      }

      return {
        notifications,
        unreadCount: count || 0
      };
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._getUnreadNotificationsFallback(userId, now);
      }
      throw err;
    }
  },

  _getUnreadNotificationsFallback(userId, now = new Date().toISOString()) {
    const unreadNotifs = Array.from(inMemoryNotifications.values())
      .filter(n => n.user_id === userId && n.type !== "popup" && !n.is_read && (!n.expires_at || n.expires_at >= now))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return {
      notifications: unreadNotifs,
      unreadCount: unreadNotifs.length
    };
  },

  // GET /notifications/popups (Filter by is_dismissed = false and expires_at >= NOW())
  async getPopups(userId) {
    const now = new Date().toISOString();
    console.log(`[NotificationService] Fetching active popups for user '${userId}'...`);
    try {
      const { data: popups, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("type", "popup")
        .or(`user_id.eq.${userId},user_id.eq.all`)
        .eq("is_dismissed", false)
        .or(`expires_at.is.null,expires_at.gte.${now}`)
        .order("created_at", { ascending: false });

      if (error) {
        if (isTableNotFoundError(error)) {
          return this._getPopupsFallback(userId, now);
        }
        throw error;
      }

      return popups;
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._getPopupsFallback(userId, now);
      }
      throw err;
    }
  },

  _getPopupsFallback(userId, now = new Date().toISOString()) {
    return Array.from(inMemoryNotifications.values())
      .filter(n => n.type === "popup" && (n.user_id === userId || n.user_id === "all") && !n.is_dismissed && (!n.expires_at || n.expires_at >= now))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  async markAsRead(notificationId, userId) {
    const now = new Date().toISOString();
    try {
      const { data, error } = await supabase
        .from("notifications")
        .update({ is_read: true, read_at: now })
        .eq("id", notificationId)
        .eq("user_id", userId)
        .select()
        .single();

      if (error) {
        if (isTableNotFoundError(error)) {
          return this._markAsReadFallback(notificationId, userId, now);
        }
        throw error;
      }
      return data;
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._markAsReadFallback(notificationId, userId, now);
      }
      throw err;
    }
  },

  _markAsReadFallback(notificationId, userId, now) {
    const notif = inMemoryNotifications.get(notificationId);
    if (!notif || (notif.user_id !== userId && notif.user_id !== "all")) {
      throw new Error("Notification not found");
    }
    notif.is_read = true;
    notif.read_at = now;
    inMemoryNotifications.set(notificationId, notif);
    return notif;
  },

  async markAsDismissed(notificationId, userId) {
    try {
      const { data, error } = await supabase
        .from("notifications")
        .update({ is_dismissed: true })
        .eq("id", notificationId)
        .or(`user_id.eq.${userId},user_id.eq.all`)
        .select()
        .single();

      if (error) {
        if (isTableNotFoundError(error)) {
          return this._markAsDismissedFallback(notificationId, userId);
        }
        throw error;
      }
      return data;
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._markAsDismissedFallback(notificationId, userId);
      }
      throw err;
    }
  },

  _markAsDismissedFallback(notificationId, userId) {
    const notif = inMemoryNotifications.get(notificationId);
    if (!notif || (notif.user_id !== userId && notif.user_id !== "all")) {
      throw new Error("Notification / Popup not found");
    }
    notif.is_dismissed = true;
    inMemoryNotifications.set(notificationId, notif);
    return notif;
  },

  async markAllAsRead(userId) {
    const now = new Date().toISOString();
    try {
      const { data, error } = await supabase
        .from("notifications")
        .update({ is_read: true, read_at: now })
        .eq("user_id", userId)
        .eq("is_read", false)
        .select();

      if (error) {
        if (isTableNotFoundError(error)) {
          return this._markAllAsReadFallback(userId, now);
        }
        throw error;
      }
      return data;
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._markAllAsReadFallback(userId, now);
      }
      throw err;
    }
  },

  _markAllAsReadFallback(userId, now) {
    const updated = [];
    for (const [id, notif] of inMemoryNotifications.entries()) {
      if (notif.user_id === userId && !notif.is_read) {
        notif.is_read = true;
        notif.read_at = now;
        inMemoryNotifications.set(id, notif);
        updated.push(notif);
      }
    }
    return updated;
  },

  async deleteNotification(notificationId, userId) {
    try {
      const { data, error } = await supabase
        .from("notifications")
        .delete()
        .eq("id", notificationId)
        .eq("user_id", userId)
        .select()
        .single();

      if (error) {
        if (isTableNotFoundError(error)) {
          return this._deleteNotificationFallback(notificationId, userId);
        }
        throw error;
      }
      return data;
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._deleteNotificationFallback(notificationId, userId);
      }
      throw err;
    }
  },

  _deleteNotificationFallback(notificationId, userId) {
    const notif = inMemoryNotifications.get(notificationId);
    if (!notif || notif.user_id !== userId) {
      throw new Error("Notification not found");
    }
    inMemoryNotifications.delete(notificationId);
    return notif;
  }
};
