import { supabase } from "../supabase.js";
import { ApiError } from "../utils/apiError.js";
import { runMatchingCycle } from "../services/matchingService.js";
import { getOpenReportSummary } from "../services/safetyService.js";
import { adService } from "../../backend/ads/adService.js";

function getWeekDates() {
  const now = new Date();
  const day = now.getDay();
  // Monday as start of week:
  const diffToMonday = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diffToMonday));
  monday.setHours(0, 0, 0, 0);

  const days = [];
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    days.push({
      date: dateStr,
      day: dayNames[i],
      isToday: dateStr === todayStr,
      matchesCount: 0,
      bannersCount: 0,
      notificationsCount: 0,
      popupsCount: 0,
      totalSlotsUsed: 0,
    });
  }
  return days;
}

export const adminPlatformController = {
  async getDashboardStats(req, res) {
    try {
      // 1. Users metrics
      const [
        { count: totalUsers },
        { count: onboardedUsers },
        { count: activeUsersCount },
        { count: pushSubscriptions },
        { count: totalMatches },
      ] = await Promise.all([
        supabase.from("users").select("id", { count: "exact", head: true }),
        supabase.from("users").select("id", { count: "exact", head: true }).eq("onboarding_completed", true),
        supabase.from("users").select("id", { count: "exact", head: true }).eq("ready_to_be_matched", true),
        supabase.from("push_subscriptions").select("id", { count: "exact", head: true }),
        supabase.from("matches").select("id", { count: "exact", head: true }),
      ]);

      // 2. Recent matches
      const { data: recentMatches } = await supabase
        .from("matches")
        .select("id, user1_id, user2_id, match_score, match_week, status, created_at")
        .order("created_at", { ascending: false })
        .limit(10);

      // 3. Dates of the week telemetry
      const weekDates = getWeekDates();
      const weekDateStrings = weekDates.map((d) => d.date);

      // Fetch ads scheduled this week
      const { data: scheduledAds } = await supabase
        .from("ads")
        .select("id, ad_type, scheduled_date, status")
        .in("scheduled_date", weekDateStrings)
        .in("status", ["approved", "pending"]);

      const adTypeMap = {
        banner: 0,
        notification: 0,
        popup: 0,
        ticket_boost: 0,
      };

      // Count all ads by category across platform
      const { data: allAds } = await supabase
        .from("ads")
        .select("id, ad_type, status");

      for (const ad of allAds || []) {
        const type = ad.ad_type || "banner";
        if (adTypeMap[type] !== undefined) {
          adTypeMap[type]++;
        } else {
          adTypeMap[type] = 1;
        }
      }

      // Populate week calendar slot data
      for (const ad of scheduledAds || []) {
        const dayEntry = weekDates.find((d) => d.date === ad.scheduled_date);
        if (dayEntry) {
          if (ad.ad_type === "banner") dayEntry.bannersCount++;
          else if (ad.ad_type === "notification") dayEntry.notificationsCount++;
          else if (ad.ad_type === "popup") dayEntry.popupsCount++;
          dayEntry.totalSlotsUsed++;
        }
      }

      // Total push notifications & popups telemetry
      const { count: pushNotificationsCount } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true });

      const popupsCount = adTypeMap.popup || 0;

      res.json({
        success: true,
        stats: {
          totalUsers: totalUsers || 0,
          onboardedUsers: onboardedUsers || 0,
          activeUsers: activeUsersCount || onboardedUsers || 0,
          pushSubscriptions: pushSubscriptions || 0,
          totalMatches: totalMatches || 0,
          totalDates: totalMatches || 0,
          pushNotificationsCount: pushNotificationsCount || 0,
          popupsCount: popupsCount,
        },
        datesOfTheWeek: weekDates,
        adCategories: adTypeMap,
        recentMatches: recentMatches || [],
      });
    } catch (err) {
      console.error("Error fetching admin stats:", err);
      // Fallback response so admin panel still renders
      const weekDates = getWeekDates();
      res.json({
        success: true,
        stats: {
          totalUsers: 0,
          onboardedUsers: 0,
          activeUsers: 0,
          pushSubscriptions: 0,
          totalMatches: 0,
          totalDates: 0,
          pushNotificationsCount: 0,
          popupsCount: 0,
        },
        datesOfTheWeek: weekDates,
        adCategories: {
          banner: 0,
          notification: 0,
          popup: 0,
          ticket_boost: 0,
        },
        recentMatches: [],
      });
    }
  },

  async getPendingAds(req, res) {
    const ads = await adService.getPendingAds();
    res.json({ success: true, data: ads });
  },

  async reviewAd(req, res) {
    const { id } = req.params;
    const { action, rejection_reason } = req.body;
    if (!["approve", "reject"].includes(action)) {
      throw new ApiError(400, "Action must be approve or reject");
    }
    const updated = await adService.reviewAd(id, action, rejection_reason);
    res.json({ success: true, data: updated });
  },

  async getPendingTickets(req, res) {
    try {
      const { data: events, error } = await supabase
        .from("events")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      res.json({ success: true, data: events || [] });
    } catch (err) {
      res.json({ success: true, data: [] });
    }
  },

  async reviewTicket(req, res) {
    const { id } = req.params;
    const { action } = req.body;
    const nextStatus = action === "approve" ? "approved" : "rejected";

    try {
      const { data, error } = await supabase
        .from("events")
        .update({ status: nextStatus })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) {
      res.json({ success: true, message: `Ticket ${nextStatus}` });
    }
  },

  async getFlaggedUsers(req, res) {
    const userSelect = `
          id,
          name,
          whatsapp_number,
          role,
          is_flagged,
          flag_reason,
          created_at,
          user_profiles (
            gender,
            age,
            height,
            build,
            skin_tone,
            personal_style,
            social_persona,
            weekend_type,
            conflict_style,
            relationship_goal,
            green_flag,
            instagram
          ),
          user_photos (
            id,
            image_url,
            photo_type,
            upload_order
          )
        `;

    // Open user reports (POST /reports). Not swallowed: needs migrations/003_safety.sql.
    const reportSummary = await getOpenReportSummary();

    let flaggedUsers = [];
    try {
      const { data, error } = await supabase
        .from("users")
        .select(userSelect)
        .eq("is_flagged", true);

      if (error) {
        if (!(error.code === "PGRST204" || (error.message && error.message.includes("column")))) {
          throw error;
        }
      } else {
        flaggedUsers = data || [];
      }
    } catch (err) {
      console.error("Error fetching flagged users:", err);
    }

    // Users with open reports who aren't admin-flagged yet.
    const flaggedIds = new Set(flaggedUsers.map((u) => u.id));
    const reportedOnlyIds = [...reportSummary.keys()].filter((id) => !flaggedIds.has(id));
    let reportedUsers = [];
    if (reportedOnlyIds.length > 0) {
      const { data, error } = await supabase
        .from("users")
        .select(userSelect)
        .in("id", reportedOnlyIds);
      if (error) {
        throw new ApiError(500, "Unable to load reported users", { details: error.message });
      }
      reportedUsers = (data || []).sort(
        (a, b) => reportSummary.get(b.id).count - reportSummary.get(a.id).count,
      );
    }

    // Added fields only; existing fields are unchanged.
    const withReports = (u) => ({
      ...u,
      open_report_count: reportSummary.get(u.id)?.count ?? 0,
      open_report_reasons: reportSummary.get(u.id)?.reasons ?? [],
    });

    res.json({ success: true, data: [...flaggedUsers, ...reportedUsers].map(withReports) });
  },

  async updateUserFlag(req, res) {
    const { id } = req.params;
    const { is_flagged, flag_reason } = req.body;

    try {
      const { data, error } = await supabase
        .from("users")
        .update({
          is_flagged: Boolean(is_flagged),
          flag_reason: is_flagged ? (flag_reason || "Flagged by administrator") : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id, name, is_flagged, flag_reason")
        .single();

      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) {
      throw new ApiError(400, "Unable to update user flag status", { details: err.message });
    }
  },

  async runMatching(req, res) {
    const result = await runMatchingCycle();
    const message = result.status === "already_ran"
      ? `Matches for week ${result.week} already exist; nothing changed`
      : `Saved ${result.inserted} matches for week ${result.week}`;
    res.json({ success: true, message, data: result });
  },
};
