import { supabase } from "../supabase.js";

export function getUtcWeekStart(date = new Date()) {
  const weekStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysSinceMonday = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday);
  return weekStart.toISOString().slice(0, 10);
}

export function trackWeeklyActiveUser(userId) {
  void Promise.resolve()
    .then(() =>
      supabase
        .from("weekly_active_users")
        .upsert(
          { user_id: userId, week_start: getUtcWeekStart() },
          { onConflict: "user_id,week_start", ignoreDuplicates: true },
        ),
    )
    .then(({ error }) => {
      if (error) throw error;
    })
    .catch((error) => {
      console.error("Unable to record weekly active user activity:", error);
    });
}
