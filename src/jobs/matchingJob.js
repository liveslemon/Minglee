import cron from "node-cron";
import { runMatchingCycle } from "../services/matchingService.js";
import "../env.js";

export function startMatchingScheduler() {
  // Run every Friday at 12:00 AM WAT (Africa/Lagos timezone).
  // Free-tier hosts may be asleep at this time, so an external scheduler should
  // also call POST /admin/matching/run; repeat runs in the same week are no-ops.
  cron.schedule("0 0 * * 5", async () => {
    console.log("[Scheduler] Triggering matching cycle...");
    try {
      await runMatchingCycle();
    } catch (error) {
      console.error("[Scheduler] Matching cycle failed:", error);
    }
  }, {
    timezone: "Africa/Lagos"
  });
  console.log("[Scheduler] Matching scheduler started (runs Friday at 12:00 AM WAT).");
}
