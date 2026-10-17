import "./env.js";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const supabaseUrl = process.env.SUPABASE_URL;
// The backend enforces authorization itself and relies on the service role to
// bypass RLS. Falling back to the anon key would silently break once RLS is on.
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
if (!supabaseKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { transport: ws }
});
