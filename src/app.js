import "./env.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { routes } from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";

// MVC wiring:
// - routes/   : HTTP routes (Express Router)
// - controllers/: translate HTTP <-> service calls
// - services/ : Prisma queries + business rules
// - validators/: Zod request validation
// - middleware/: cross-cutting concerns (auth, errors)

const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

// CORS_ORIGINS: comma-separated exact origins, e.g. "https://app.example.com".
function parseCorsOrigins(value) {
  const origins = (value || "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid CORS_ORIGINS entry "${origin}": expected an origin like https://app.example.com`);
    }
    if (origin.includes("*")) {
      throw new Error(`Invalid CORS_ORIGINS entry "${origin}": wildcards are not supported, list each origin`);
    }
    if (parsed.origin !== origin) {
      throw new Error(`Invalid CORS_ORIGINS entry "${origin}": use the bare origin "${parsed.origin}" (no path or wildcard)`);
    }
  }
  return new Set(origins);
}

function corsOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  const allowed = parseCorsOrigins(process.env.CORS_ORIGINS);

  if (isProduction && allowed.size === 0) {
    throw new Error("CORS_ORIGINS must be set in production (comma-separated list of allowed frontend origins)");
  }

  return {
    credentials: true,
    origin(origin, callback) {
      // No Origin header: curl, server-to-server calls, webhooks.
      if (!origin) return callback(null, true);
      if (allowed.has(origin)) return callback(null, true);
      if (!isProduction && LOCALHOST_ORIGIN_RE.test(origin)) return callback(null, true);
      return callback(null, false);
    },
  };
}

export function createApp() {
  const app = express();

  // Render terminates TLS in front of us; trust exactly one proxy hop so
  // req.ip is the client address (used by rate limiting) and can't be spoofed
  // with extra X-Forwarded-For entries.
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors(corsOptions()));
  app.use(express.json({
    limit: "128kb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));

  app.use(routes);
  app.use(errorHandler);

  return app;
}
