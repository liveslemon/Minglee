import "./env.js";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
if (!supabaseKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY");

export const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { transport: ws }
});
