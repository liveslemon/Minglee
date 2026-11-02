export class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

// Wraps a raw internal error (e.g. a Supabase/Postgres error) for a consumer-facing
// response: logs the real cause server-side, but surfaces only a simple, safe message.
export function dbApiError(statusCode, message, rawError) {
  // eslint-disable-next-line no-console
  console.error(message, rawError);
  return new ApiError(statusCode, message);
}

