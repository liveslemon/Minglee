# Minglee backend (Supabase Postgres)

## Setup

1. Install deps:
   - `npm i`
2. Create `.env` from `.env.example` and fill:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (preferred) or `SUPABASE_ANON_KEY`
   - `JWT_SECRET`
   - `SUPABASE_USER_PHOTOS_BUCKET` (e.g. `user-photos`)
3. Run:
   - PowerShell: `$env:NODE_OPTIONS='--use-system-ca'; npm.cmd run dev`

Important: keep `.env` private (it is ignored by `backend/.gitignore`).

## Supabase SQL

The canonical schema and upgrade SQL is in `backend/schema.sql`. Review and apply it manually in Supabase; the application does not execute schema migrations on startup. Other SQL schema files are retained as historical references and should not be applied separately.

For weekly active users, apply only `backend/migrations/20261028_weekly_active_users.sql` using the Supabase SQL Editor. This small, repeat-safe migration creates the activity table and index, then enables row-level security; it does not modify user data or run the rest of the canonical schema.

For push notification subscriptions, apply the additive migration in `migrations/20261008_push_subscriptions.sql` using the Supabase SQL Editor. This migration only creates the `push_subscriptions` table and its user index; it does not apply unrelated canonical schema changes.

Ad image uploads use the public Supabase Storage bucket configured by `SUPABASE_ADS_BUCKET`, falling back to `SUPABASE_USER_PHOTOS_BUCKET`. The bucket must exist and allow public reads for the returned image URLs to display in the app.

This backend expects your Postgres schema to include a `public.users` table with:
- `id uuid primary key default gen_random_uuid()`
- `name text not null`
- `whatsapp_number text not null unique`
- `password_hash text not null`

## Endpoints

### `POST /auth/signup`
Request:
```json
{ "name": "Jane", "whatsapp_number": "+2348012345678", "password": "min8chars" }
```
Response:
```json
{ "user": { "id": "uuid", "name": "Jane", "whatsapp_number": "+2348012345678", "role": "user" }, "access_token": "jwt" }
```

### `POST /auth/login`
Request:
```json
{ "whatsapp_number": "+2348012345678", "password": "min8chars" }
```
Response:
```json
{ "user": { "id": "uuid", "name": "Jane", "whatsapp_number": "+2348012345678", "role": "user" }, "access_token": "jwt" }
```

### `POST /admin/notifications/send`
Requires the `x-admin-secret` header to match the server's `ADMIN_SECRET`. Creates an in-app notification for all users, or one user when `targetAudience` is `"single"` and `targetUserId` is provided. If VAPID is configured and recipients have registered subscriptions, it also sends web push notifications and reports delivery counts.

Request:
```json
{ "title": "Update", "body": "An update from Minglee", "url": "/home", "targetAudience": "all" }
```

### `GET /admin/stats/weekly-active-users`
Requires the `x-admin-secret` header to match the server's `ADMIN_SECRET`. Returns distinct weekly active-user counts for the last 12 Monday-to-Sunday UTC weeks, including the current week. Apply `backend/migrations/20261028_weekly_active_users.sql` in Supabase before using this endpoint, and configure `SUPABASE_SERVICE_ROLE_KEY` so the backend can access the row-level-security-protected activity table.

Response:
```json
{
  "success": true,
  "weekStart": "2026-10-26",
  "weekEnd": "2026-11-01",
  "weeklyActiveUsers": 42,
  "weeks": [
    { "weekStart": "2026-10-19", "weekEnd": "2026-10-25", "weeklyActiveUsers": 37 },
    { "weekStart": "2026-10-26", "weekEnd": "2026-11-01", "weeklyActiveUsers": 42 }
  ]
}
```

### `POST /profile` (Auth)
Request:
```json
{ "gender": "Female", "age": 22, "height": 168, "build": "Athletic", "skin_tone": "Brown", "instagram": "@jane" }
```
Response:
```json
{ "profile": { "gender": "Female", "age": 22, "height": 168, "build": "Athletic", "skin_tone": "Brown" } }
```

### `POST /preferences` (Auth)
Request:
```json
{ "preferred_min_age": 21, "preferred_max_age": 28, "preferred_min_height": 160, "preferred_max_height": 190 }
```
Response:
```json
{ "preferences": { "preferred_min_age": 21, "preferred_max_age": 28, "preferred_min_height": 160, "preferred_max_height": 190 } }
```

### `POST /focuses` (Auth)
Request:
```json
{ "focuses": ["Getting my degree and doing well", "Building a business/project on the side"] }
```
Response:
```json
{ "focuses": ["Getting my degree and doing well", "Building a business/project on the side"] }
```

### `POST /preferred-builds` (Auth)
Request:
```json
{ "builds": ["Slim", "Average"] }
```
Response:
```json
{ "preferred_builds": ["Slim", "Average"] }
```

### `POST /photos` (Auth)
Request:
```json
{ "photos": [{ "image_url": "https://example.com/1.jpg", "photo_type": "Profile", "upload_order": 1 }, { "image_url": "https://example.com/2.jpg", "photo_type": "Gallery", "upload_order": 2 }] }
```
Response:
```json
{ "photos": [{ "image_url": "https://example.com/1.jpg", "photo_type": "Profile", "upload_order": 1 }] }
```

### `POST /photos/upload` (Auth)
Uploads a single image file (`multipart/form-data`) and returns an `image_url` you can send to `POST /photos`.

### `GET /me/profile` (Auth)
Response:
```json
{ "user": { "id": "uuid", "name": "Jane", "whatsapp_number": "+234..." }, "profile": { "age": 22 }, "preferences": { "preferred_min_age": 21 }, "focuses": ["Getting my degree and doing well"], "preferred_builds": ["Slim"], "photos": [{ "image_url": "https://..." }] }
```

### `GET /health`
Response:
```json
{ "ok": true }
```
