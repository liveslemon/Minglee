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

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "128kb" }));

  app.use(routes);
  app.use(errorHandler);

  return app;
}

