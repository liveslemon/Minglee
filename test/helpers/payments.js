import { setEnv } from "./env.js";

let version = 0;

// paymentService.js reads PAYSTACK_SECRET_KEY / FLUTTERWAVE_SECRET_KEY /
// PAYMENTS_MOCK_MODE / NODE_ENV once at import time. Import a fresh copy of the
// module under the given env (cache-busted with a query string). Its own
// imports (supabase.js, apiError.js) stay shared, so `instanceof ApiError` holds.
export async function loadPaymentService(env) {
  const restore = setEnv({
    PAYSTACK_SECRET_KEY: undefined,
    FLUTTERWAVE_SECRET_KEY: undefined,
    PAYMENTS_MOCK_MODE: undefined,
    NODE_ENV: "test",
    ...env,
  });
  try {
    const url = new URL(`../../backend/payments/paymentService.js?v=${++version}`, import.meta.url);
    const mod = await import(url.href);
    return mod.paymentService;
  } finally {
    restore();
  }
}
