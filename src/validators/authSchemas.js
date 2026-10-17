import { z } from "zod";
import { normalizePhone } from "../utils/phone.js";

// Validates that the number can be normalized; the service does the actual
// normalization because it also needs the raw input to find legacy rows.
const whatsappNumber = z
  .string()
  .trim()
  .min(5, "WhatsApp number is required")
  .max(25)
  .refine((value) => normalizePhone(value) !== null, {
    message:
      "Enter a valid WhatsApp number, e.g. 08031234567 or +2348031234567. Non-Nigerian numbers must start with + and the country code.",
  });

export const signupSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    whatsapp_number: whatsappNumber,
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(200),
  })
  .strict();

export const loginSchema = z
  .object({
    whatsapp_number: whatsappNumber,
    password: z.string().min(1).max(200),
  })
  .strict();
