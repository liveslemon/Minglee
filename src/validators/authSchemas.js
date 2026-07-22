import { z } from "zod";

export const signupSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    whatsapp_number: z
      .string()
      .trim()
      .min(5, "WhatsApp number is required")
      .max(25),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(200),
  })
  .strict();

export const loginSchema = z
  .object({
    whatsapp_number: z.string().min(5).max(25),
    password: z.string().min(1).max(200),
  })
  .strict();
