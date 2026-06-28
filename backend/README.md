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

Important: keep `.env` private (it is ignored by the repo root `.gitignore`).

## Supabase SQL

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
