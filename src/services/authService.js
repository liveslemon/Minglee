import bcrypt from "bcryptjs";
import { supabase } from "../supabase.js";
import { ApiError } from "../utils/apiError.js";
import { normalizePhone, phoneLookupForms } from "../utils/phone.js";

const USER_COLUMNS =
  "id,name,whatsapp_number,role,ready_to_be_matched,onboarding_completed,current_step,created_at,updated_at";

// Rows created before normalization store the number as the user typed it, so
// lookups must match every equivalent spelling (see phoneLookupForms).
async function findUsersByPhone(rawNumber, columns) {
  const { data, error } = await supabase
    .from("users")
    .select(columns)
    .in("whatsapp_number", phoneLookupForms(rawNumber));

  if (error) throw new ApiError(400, "Database error", { message: error.message, details: error.details });
  return data;
}

export async function signup({ name, whatsapp_number, password }) {
  const normalized = normalizePhone(whatsapp_number);

  const existing = await findUsersByPhone(whatsapp_number, "id");
  if (existing.length > 0) throw new ApiError(409, "An account with this WhatsApp number already exists");

  const passwordHash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase
    .from("users")
    .insert({ name, whatsapp_number: normalized, password_hash: passwordHash })
    .select(USER_COLUMNS)
    .single();

  if (error?.code === "23505") throw new ApiError(409, "An account with this WhatsApp number already exists");
  if (error) throw new ApiError(400, "Unable to create user", { message: error.message, details: error.details });
  return data;
}

// Exact normalized match wins. Otherwise (only legacy rows), try the row stored
// exactly as typed first, then oldest first, and take the first whose password matches.
function orderCandidates(rows, normalized, raw) {
  const exact = rows.find((row) => row.whatsapp_number === normalized);
  if (exact) return [exact];

  const rank = (row) => (row.whatsapp_number === raw ? 0 : 1);
  return [...rows].sort(
    (a, b) => rank(a) - rank(b) || String(a.created_at).localeCompare(String(b.created_at))
  );
}

export async function login({ whatsapp_number, password }) {
  const normalized = normalizePhone(whatsapp_number);
  const rows = await findUsersByPhone(whatsapp_number, `${USER_COLUMNS},password_hash`);
  if (rows.length === 0) throw new ApiError(401, "Invalid credentials");

  let user = null;
  for (const candidate of orderCandidates(rows, normalized, whatsapp_number)) {
    if (await bcrypt.compare(password, candidate.password_hash)) {
      user = candidate;
      break;
    }
  }
  if (!user) throw new ApiError(401, "Invalid credentials");

  // Upgrade a legacy-format row to the normalized number. Only safe when no
  // other row already holds the normalized form; the lookup above included it,
  // so a legacy match here means none did.
  const normalizedTaken = rows.some((row) => row.whatsapp_number === normalized);
  if (user.whatsapp_number !== normalized && !normalizedTaken) {
    const { data: updated, error } = await supabase
      .from("users")
      .update({ whatsapp_number: normalized })
      .eq("id", user.id)
      .eq("whatsapp_number", user.whatsapp_number)
      .select("whatsapp_number");

    if (error) throw new ApiError(400, "Database error", { message: error.message, details: error.details });
    // Zero rows means the number changed concurrently; report what is stored.
    if (updated.length === 1) user = { ...user, whatsapp_number: updated[0].whatsapp_number };
  }

  // Don't leak password_hash
  // eslint-disable-next-line no-unused-vars
  const { password_hash: _passwordHash, ...safeUser } = user;
  return safeUser;
}
