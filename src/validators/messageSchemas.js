import { z } from "zod";

export const sendMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(2000),
  })
  .strict();
