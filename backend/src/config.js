import "./env.js";

export const config = {
  port: Number(process.env.PORT || 4000),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  jwtSecret: process.env.JWT_SECRET,
  userPhotosBucket: process.env.SUPABASE_USER_PHOTOS_BUCKET || "user-photos"
};

