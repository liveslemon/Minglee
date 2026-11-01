import "./env.js";
import dotenv from "dotenv";
dotenv.config();
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

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({
    limit: "128kb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));

  app.use(routes);
  app.use(errorHandler);

  // Demo-date endpoint – returns ISO string; can be overridden via DEMO_DATE env var
  app.get("/api/demo-date", (req, res) => {
    const demoDate = process.env.DEMO_DATE;
    const now = demoDate ? new Date(demoDate) : new Date();
    res.json({ demoDate: now.toISOString() });
  });

  return app;
}

