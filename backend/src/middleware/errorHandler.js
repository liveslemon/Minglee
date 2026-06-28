import { ZodError } from "zod";
import { ApiError } from "../utils/apiError.js";

export function errorHandler(err, _req, res, _next) {
  // Multer (multipart/form-data) errors (e.g. file too large)
  if (err?.name === "MulterError") {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File too large" : "Invalid upload";
    return res.status(400).json({ error: message, details: { code: err.code } });
  }

  // Zod validation
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Invalid input", details: err.flatten() });
  }

  // Our typed errors
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      details: err.details ?? undefined
    });
  }

  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: "Server error" });
}
