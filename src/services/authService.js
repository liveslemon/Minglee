import bcrypt from "bcryptjs";
import { supabase } from "../supabase.js";
import { ApiError, dbApiError } from "../utils/apiError.js";

export async function signup({ name, whatsapp_number, password }) {
  const passwordHash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase
    .from("users")
    .insert({ name, whatsapp_number, password_hash: passwordHash })
    .select("id,name,whatsapp_number,role,ready_to_be_matched,onboarding_completed,current_step,created_at,updated_at")
    .single();

  if (error) {
    if (error.code === "23505") throw new ApiError(409, "An account with this number already exists");
    throw dbApiError(400, "Unable to create user", error);
  }
  return data;
}

export async function login({ whatsapp_number, password }) {
  const { data: user, error } = await supabase
    .from("users")
    .select("id,name,whatsapp_number,password_hash,role,ready_to_be_matched,onboarding_completed,current_step,created_at,updated_at")
    .eq("whatsapp_number", whatsapp_number)
    .maybeSingle();

  if (error) throw dbApiError(400, "Database error", error);
  if (!user) throw new ApiError(401, "Invalid credentials");

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new ApiError(401, "Invalid credentials");

  // Don't leak password_hash
  // eslint-disable-next-line no-unused-vars
  const { password_hash: _passwordHash, ...safeUser } = user;
  return safeUser;
}
