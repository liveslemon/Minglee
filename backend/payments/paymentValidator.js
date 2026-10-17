import { z } from "zod";

// amount and user_id are intentionally absent: the price comes from the event
// record and the user comes from the verified JWT.
export const initializePaymentSchema = z.object({
  event_id: z.string().uuid("Valid event_id UUID is required"),
  email: z.string().email("Valid user email is required"),
  gateway: z.enum(["paystack", "flutterwave"]).default("paystack"),
  callback_url: z.string().url().optional()
});

export const verifyPaymentSchema = z.object({
  reference: z.string().min(1, "Payment reference is required")
});
