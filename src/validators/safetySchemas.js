import { z } from "zod";

export const createReportSchema = z
  .object({
    reported_user_id: z.string().trim().uuid(),
    reason: z.string().trim().min(1).max(200),
    // Optional free text sent by the profile page's report form.
    details: z.string().trim().max(2000).optional(),
  })
  .strict();

export const userIdParamSchema = z
  .object({
    id: z.string().trim().uuid(),
  })
  .strict();
