import { normalizePhone } from "../utils/phone.js";
import { ApiError } from "../utils/apiError.js";

// Small in-memory fixed-window rate limiter. State is per process: it resets on
// restart and is not shared between instances (fine for a single Render dyno).

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export function createRateLimiter({ windowMs, max, maxKeys = 10_000 }) {
  const entries = new Map(); // key -> { count, resetAt }

  function prune(now) {
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
  }

  const sweeper = setInterval(() => prune(Date.now()), windowMs);
  sweeper.unref();

  function current(key, now) {
    const entry = entries.get(key);
    if (entry && entry.resetAt > now) return entry;
    if (entry) entries.delete(key);
    return null;
  }

  return {
    // Counts one attempt. Returns 0 if allowed, otherwise seconds until retry.
    consume(key, now = Date.now()) {
      const entry = current(key, now);
      if (entry) {
        if (entry.count >= max) return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
        entry.count += 1;
        return 0;
      }

      if (entries.size >= maxKeys) {
        prune(now);
        // Still full: evict the oldest keys (Map keeps insertion order).
        for (const oldest of entries.keys()) {
          if (entries.size < maxKeys) break;
          entries.delete(oldest);
        }
      }
      entries.set(key, { count: 1, resetAt: now + windowMs });
      return 0;
    },
    // Gives back an attempt that turned out not to count.
    release(key, now = Date.now()) {
      const entry = current(key, now);
      if (entry && entry.count > 0) entry.count -= 1;
    },
    reset(key) {
      entries.delete(key);
    },
    get size() {
      return entries.size;
    },
  };
}

function tooManyRequests(res, retryAfterSeconds) {
  res.set("Retry-After", String(retryAfterSeconds));
  return new ApiError(429, "Too many attempts. Please try again later.", { retry_after_seconds: retryAfterSeconds });
}

// Every /auth request counts, per client IP. Generous because students on
// campus Wi-Fi or carrier NAT share a public IP.
const authIpLimiter = createRateLimiter({ windowMs: FIFTEEN_MINUTES, max: 100 });

export function authIpRateLimit(req, res, next) {
  const retryAfter = authIpLimiter.consume(req.ip);
  if (retryAfter) return next(tooManyRequests(res, retryAfter));
  return next();
}

// Failed logins per phone number. An attempt is counted when it starts (so a
// burst of parallel requests can't slip past) and given back if it turns out
// not to be a wrong-password failure; a successful login clears the counter.
const loginFailureLimiter = createRateLimiter({ windowMs: FIFTEEN_MINUTES, max: 10 });

function phoneKey(body) {
  const raw = typeof body?.whatsapp_number === "string" ? body.whatsapp_number : "";
  return normalizePhone(raw) ?? raw.trim();
}

export function loginFailureRateLimit(req, res, next) {
  const key = phoneKey(req.body);
  const retryAfter = loginFailureLimiter.consume(key);
  if (retryAfter) return next(tooManyRequests(res, retryAfter));

  res.on("finish", () => {
    if (res.statusCode === 401) return;
    if (res.statusCode >= 200 && res.statusCode < 300) loginFailureLimiter.reset(key);
    else loginFailureLimiter.release(key);
  });
  return next();
}
