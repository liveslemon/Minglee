import { z } from "zod";

export const createReportSchema = z
  .object({
    reported_user_id: z.string().trim().uuid(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
