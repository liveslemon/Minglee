// Import this FIRST in every test file (before any module from src/ or backend/).
// ESM evaluates sibling imports in order, so setting process.env here runs
// before src/supabase.js, src/middleware/auth.js, etc. read it.
const defaults = {
  SUPABASE_URL: "http://127.0.0.1:9",
  SUPABASE_SERVICE_ROLE_KEY: "x",
  JWT_SECRET: "t",
  DOTENV_CONFIG_PATH: "/dev/null",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}

// Never let a developer's real gateway keys or admin secret leak into tests.
delete process.env.PAYSTACK_SECRET_KEY;
delete process.env.FLUTTERWAVE_SECRET_KEY;
delete process.env.PAYMENTS_MOCK_MODE;
delete process.env.ADMIN_SECRET;

export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_HOST = new URL(SUPABASE_URL).host;

// Set/unset env vars (undefined deletes) and return a function restoring them.
export function setEnv(vars) {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
