import { supabase } from "../../src/supabase.js";
import crypto from "crypto";
import path from "node:path";
import { ApiError } from "../../src/utils/apiError.js";
import { config } from "../../src/config.js";

const inMemoryAds = new Map();

function isTableNotFoundError(error) {
  return error && (error.code === "PGRST205" || error.code === "42P01" || (error.message && error.message.includes("schema cache")));
}

function getDailyLimit(adType) {
  switch (adType) {
    case "banner":
      return 3;
    case "ticket_boost":
      return 3;
    case "notification":
      return 1;
    case "popup":
      return 1;
    default:
      return 3;
  }
}

export const adService = {
  async uploadAdImage(userId, file) {
    if (!userId) throw new ApiError(401, "Unauthorized");
    if (!file?.buffer || !file.mimetype?.startsWith("image/")) {
      throw new ApiError(400, "Choose a valid image file to upload");
    }

    // Ad images are shown to everyone, so they live in their own public
    // bucket; the user photos bucket is private.
    const bucketName = config.adsBucket;
    if (bucketName === config.userPhotosBucket) {
      throw new Error(
        "SUPABASE_ADS_BUCKET must be a public bucket separate from SUPABASE_USER_PHOTOS_BUCKET",
      );
    }
    const extension = path.extname(file.originalname || "").toLowerCase();
    const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : "";
    const filePath = `ads/${userId}/${crypto.randomUUID()}${safeExtension}`;
    const { error } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (error) {
      throw new ApiError(502, "Could not store the ad image", {
        storage: error.message
      });
    }

    const { data } = supabase.storage.from(bucketName).getPublicUrl(filePath);
    if (!data?.publicUrl) {
      throw new ApiError(502, "Could not create a public URL for the ad image");
    }
    return { image_url: data.publicUrl };
  },

  async checkSlotAvailability(adType, scheduledDate) {
    const targetDate = scheduledDate || new Date().toISOString().slice(0, 10);
    const maxAllowed = getDailyLimit(adType);

    try {
      const { data: ads, error } = await supabase
        .from("ads")
        .select("id, ad_type, scheduled_date, status")
        .eq("scheduled_date", targetDate)
        .eq("ad_type", adType)
        .in("status", ["approved", "pending"]);

      if (error) {
        if (isTableNotFoundError(error)) {
          return this._checkSlotAvailabilityFallback(adType, targetDate);
        }
        throw error;
      }

      const count = ads?.length || 0;
      const isAvailable = count < maxAllowed;

      return {
        ad_type: adType,
        scheduled_date: targetDate,
        max_allowed: maxAllowed,
        current_count: count,
        is_available: isAvailable,
        reason: isAvailable ? null : "Clashing of dates with another advert",
      };
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._checkSlotAvailabilityFallback(adType, targetDate);
      }
      throw err;
    }
  },

  _checkSlotAvailabilityFallback(adType, targetDate) {
    const maxAllowed = getDailyLimit(adType);
    let count = 0;
    for (const ad of inMemoryAds.values()) {
      if (ad.ad_type === adType && ad.scheduled_date === targetDate && (ad.status === "approved" || ad.status === "pending")) {
        count++;
      }
    }
    const isAvailable = count < maxAllowed;
    return {
      ad_type: adType,
      scheduled_date: targetDate,
      max_allowed: maxAllowed,
      current_count: count,
      is_available: isAvailable,
      reason: isAvailable ? null : "Clashing of dates with another advert",
    };
  },

  async createAd(data, userId = null) {
    const adType = data.ad_type || "banner";
    const scheduledDate = data.scheduled_date || (data.start_date ? data.start_date.slice(0, 10) : new Date().toISOString().slice(0, 10));

    // Verify slot clash
    const availability = await this.checkSlotAvailability(adType, scheduledDate);
    if (!availability.is_available) {
      throw new ApiError(409, "Clashing of dates with another advert", {
        reason: "Clashing of dates with another advert",
        scheduled_date: scheduledDate,
        ad_type: adType,
      });
    }

    const payload = {
      user_id: userId,
      ad_type: adType,
      title: data.title || "Promotion",
      text_content: data.text_content || "",
      image_url: data.image_url || null,
      target_url: data.target_url || null,
      popup_id: data.popup_id || null,
      scheduled_date: scheduledDate,
      start_time: data.start_time || data.start_date || new Date().toISOString(),
      end_time: data.end_time || data.end_date || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      placement: data.placement || (adType === "popup" ? "popup" : "home-banner"),
      status: "pending",
      impressions: 0,
      clicks: 0,
      start_date: data.start_date || new Date().toISOString(),
      end_date: data.end_date || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      is_active: data.is_active ?? true,
      created_at: new Date().toISOString()
    };

    try {
      const { data: ad, error } = await supabase
        .from("ads")
        .insert([payload])
        .select()
        .single();

      if (error) {
        if (isTableNotFoundError(error) || (error.message && error.message.includes("column"))) {
          return this._createAdFallback(payload);
        }
        throw error;
      }
      return ad;
    } catch (err) {
      if (isTableNotFoundError(err) || (err.message && err.message.includes("column"))) {
        return this._createAdFallback(payload);
      }
      throw err;
    }
  },

  _createAdFallback(payload) {
    const ad = {
      id: crypto.randomUUID(),
      ...payload
    };
    inMemoryAds.set(ad.id, ad);
    return ad;
  },

  async getActiveAds(filters = {}) {
    const targetDate = filters.date ? new Date(filters.date).toISOString() : new Date().toISOString();

    try {
      let query = supabase
        .from("ads")
        .select("*")
        .eq("is_active", true)
        .lte("start_date", targetDate)
        .gte("end_date", targetDate);

      if (filters.placement) {
        query = query.eq("placement", filters.placement);
      }
      if (filters.ad_type) {
        query = query.eq("ad_type", filters.ad_type);
      }

      query = query.order("created_at", { ascending: false });

      const { data: ads, error } = await query;

      if (error) {
        if (isTableNotFoundError(error)) {
          return this._getActiveAdsFallback(filters, targetDate);
        }
        throw error;
      }
      return ads || [];
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._getActiveAdsFallback(filters, targetDate);
      }
      throw err;
    }
  },

  _getActiveAdsFallback(filters, targetDate) {
    const t = new Date(targetDate).getTime();
    return Array.from(inMemoryAds.values()).filter(ad => {
      if (!ad.is_active) return false;
      if (filters.placement && ad.placement !== filters.placement) return false;
      if (filters.ad_type && ad.ad_type !== filters.ad_type) return false;
      const start = new Date(ad.start_date || ad.start_time).getTime();
      const end = new Date(ad.end_date || ad.end_time).getTime();
      return start <= t && t <= end;
    });
  },

  async getPendingAds() {
    try {
      const { data: ads, error } = await supabase
        .from("ads")
        .select("*, users:user_id(id, name, whatsapp_number, is_flagged, flag_reason)")
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) {
        if (isTableNotFoundError(error)) {
          return Array.from(inMemoryAds.values()).filter(a => a.status === "pending");
        }
        throw error;
      }
      return ads || [];
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return Array.from(inMemoryAds.values()).filter(a => a.status === "pending");
      }
      throw err;
    }
  },

  async reviewAd(id, action, rejectionReason = null) {
    const ad = inMemoryAds.get(id);

    if (action === "approve") {
      // Re-verify slot clash limit
      try {
        const { data: existing, error: fetchErr } = await supabase
          .from("ads")
          .select("*")
          .eq("id", id)
          .single();

        const currentAd = existing || ad;
        if (currentAd) {
          const maxAllowed = getDailyLimit(currentAd.ad_type);
          const { count, error: countErr } = await supabase
            .from("ads")
            .select("id", { count: "exact", head: true })
            .eq("scheduled_date", currentAd.scheduled_date)
            .eq("ad_type", currentAd.ad_type)
            .eq("status", "approved")
            .neq("id", id);

          if (!countErr && (count || 0) >= maxAllowed) {
            throw new ApiError(409, "Clashing of dates with another advert", {
              reason: "Clashing of dates with another advert"
            });
          }
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
      }
    }

    const updatePayload = {
      status: action === "approve" ? "approved" : "rejected",
      rejection_reason: action === "reject" ? (rejectionReason || "Clashing of dates with another advert") : null,
      reviewed_at: new Date().toISOString()
    };

    try {
      const { data: updatedAd, error: updateErr } = await supabase
        .from("ads")
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();

      if (updateErr) {
        if (isTableNotFoundError(updateErr)) {
          if (ad) {
            Object.assign(ad, updatePayload);
            return ad;
          }
        }
        throw updateErr;
      }
      return updatedAd;
    } catch (err) {
      if (isTableNotFoundError(err) && ad) {
        Object.assign(ad, updatePayload);
        return ad;
      }
      throw err;
    }
  },

  async trackImpression(id) {
    try {
      const { data: ad, error: fetchErr } = await supabase
        .from("ads")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchErr) {
        if (isTableNotFoundError(fetchErr)) {
          return this._trackImpressionFallback(id);
        }
        throw fetchErr;
      }

      const newImpressions = (ad.impressions || 0) + 1;
      const { data: updatedAd, error: updateErr } = await supabase
        .from("ads")
        .update({ impressions: newImpressions })
        .eq("id", id)
        .select()
        .single();

      if (updateErr) throw updateErr;
      return updatedAd;
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._trackImpressionFallback(id);
      }
      throw err;
    }
  },

  _trackImpressionFallback(id) {
    const ad = inMemoryAds.get(id);
    if (!ad) {
      throw new Error("Ad not found");
    }
    ad.impressions = (ad.impressions || 0) + 1;
    inMemoryAds.set(id, ad);
    return ad;
  },

  async trackClick(id) {
    try {
      const { data: ad, error: fetchErr } = await supabase
        .from("ads")
        .select("*")
        .eq("id", id)
        .single();

      if (fetchErr) {
        if (isTableNotFoundError(fetchErr)) {
          return this._trackClickFallback(id);
        }
        throw fetchErr;
      }

      const newClicks = (ad.clicks || 0) + 1;
      const { data: updatedAd, error: updateErr } = await supabase
        .from("ads")
        .update({ clicks: newClicks })
        .eq("id", id)
        .select()
        .single();

      if (updateErr) throw updateErr;
      return updatedAd;
    } catch (err) {
      if (isTableNotFoundError(err)) {
        return this._trackClickFallback(id);
      }
      throw err;
    }
  },

  _trackClickFallback(id) {
    const ad = inMemoryAds.get(id);
    if (!ad) {
      throw new Error("Ad not found");
    }
    ad.clicks = (ad.clicks || 0) + 1;
    inMemoryAds.set(id, ad);
    return ad;
  }
};
