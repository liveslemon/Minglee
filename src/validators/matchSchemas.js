import { z } from "zod";

export const matchFeedbackSchema = z
  .object({
    rating: z.enum(["loved", "nice", "neutral", "uncomfortable"]),
  })
  .strict();
