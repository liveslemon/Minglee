import { z } from "zod";

export const signupSchema = z
  .object({
    name: z.string().min(1).max(80),
    whatsapp_number: z.string().min(5).max(25),
    password: z.string().min(8).max(200)
  })
  .strict();

export const loginSchema = z
  .object({
    whatsapp_number: z.string().min(5).max(25),
    password: z.string().min(1).max(200)
  })
  .strict();

