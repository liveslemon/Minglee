import { z } from "zod";

export const matchFeedbackSchema = z
  .object({
    rating: z.enum(["loved", "nice", "neutral", "uncomfortable"]),
  })
  .strict();

export const matchIdParamSchema = z
  .object({
    id: z.string().trim().uuid(),
  })
  .strict();
