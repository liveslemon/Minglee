# Mingle Matchmaking API (Frontend Reference)

Base URL (local): `http://localhost:4000`

All authenticated endpoints require:
- Header: `Authorization: Bearer <access_token>`

## Health

### `GET /health`
Response:
```json
{ "ok": true }
```

## Auth

### `POST /auth/signup`
Request:
```json
{
  "name": "Jane",
  "whatsapp_number": "+2348012345678",
  "password": "min8chars"
}
```
Response:
```json
{
  "user": {
    "id": "uuid",
    "name": "Jane",
    "whatsapp_number": "+2348012345678",
    "role": "user",
    "onboarding_completed": false,
    "current_step": 1,
    "created_at": "2026-05-09T00:00:00.000Z",
    "updated_at": "2026-05-09T00:00:00.000Z"
  },
  "access_token": "jwt"
}
```

### `POST /auth/login`
Request:
```json
{
  "whatsapp_number": "+2348012345678",
  "password": "min8chars"
}
```
Response:
```json
{
  "user": {
    "id": "uuid",
    "name": "Jane",
    "whatsapp_number": "+2348012345678",
    "role": "user",
    "onboarding_completed": false,
    "current_step": 1,
    "created_at": "2026-05-09T00:00:00.000Z",
    "updated_at": "2026-05-09T00:00:00.000Z"
  },
  "access_token": "jwt"
}
```

## Onboarding / Profile (Auth)

### `POST /profile`
Create or update the user’s matchmaking profile.

Request (any subset is allowed; strict validation on types/enums):
```json
{
  "gender": "Female",
  "age": 22,
  "height": 168,
  "build": "Athletic",
  "skin_tone": "Brown",
  "personal_style": "Minimal",
  "social_persona": "Outgoing",
  "weekend_type": "Chill",
  "afternoon_activity": "Movies",
  "habits": "Gym",
  "conflict_style": "Talk it out",
  "relationship_goal": "Long-term",
  "green_flag": "Kindness",
  "instagram": "@jane",
  "tiktok": "@jane"
}
```
Response:
```json
{
  "profile": {
    "gender": "Female",
    "age": 22,
    "height": 168,
    "build": "Athletic",
    "skin_tone": "Brown",
    "personal_style": "Minimal",
    "social_persona": "Outgoing",
    "weekend_type": "Chill",
    "afternoon_activity": "Movies",
    "habits": "Gym",
    "conflict_style": "Talk it out",
    "relationship_goal": "Long-term",
    "green_flag": "Kindness",
    "instagram": "@jane",
    "tiktok": "@jane"
  }
}
```

### `POST /preferences`
Create or update partner preferences.

Request:
```json
{
  "preferred_min_age": 21,
  "preferred_max_age": 28,
  "preferred_min_height": 160,
  "preferred_max_height": 190
}
```
Response:
```json
{
  "preferences": {
    "preferred_min_age": 21,
    "preferred_max_age": 28,
    "preferred_min_height": 160,
    "preferred_max_height": 190
  }
}
```

### `POST /focuses`
Save Q9 focus selections (max 2).

Allowed focus values:
- `Getting my degree and doing well`
- `Building a business/project on the side`
- `Balancing school and enjoying life`
- `Still figuring things out`

Request:
```json
{
  "focuses": [
    "Getting my degree and doing well",
    "Building a business/project on the side"
  ]
}
```
Response:
```json
{
  "focuses": [
    "Getting my degree and doing well",
    "Building a business/project on the side"
  ]
}
```

### `POST /preferred-builds`
Save preferred builds (multi-select).

Allowed build values:
- `Slim`
- `Athletic`
- `Average`
- `Curvy`

Request:
```json
{ "builds": ["Slim", "Average"] }
```
Response:
```json
{ "preferred_builds": ["Slim", "Average"] }
```

### `POST /photos`
Save uploaded photo URLs (min 2, max 3). `upload_order` must be unique.

Allowed `photo_type` values:
- `Profile`
- `Gallery`

Request:
```json
{
  "photos": [
    { "image_url": "https://example.com/1.jpg", "photo_type": "Profile", "upload_order": 1 },
    { "image_url": "https://example.com/2.jpg", "photo_type": "Gallery", "upload_order": 2 }
  ]
}
```
Response:
```json
{
  "photos": [
    { "image_url": "https://example.com/1.jpg", "photo_type": "Profile", "upload_order": 1 },
    { "image_url": "https://example.com/2.jpg", "photo_type": "Gallery", "upload_order": 2 }
  ]
}
```

### `POST /photos/upload`
Upload a single image file to storage and get back an `image_url` you can pass into `POST /photos`.

- Content-Type: `multipart/form-data`
- Field name: any (the API takes the first file)
- Max size: 5MB

Response:
```json
{ "image_url": "https://.../storage/v1/object/public/user-photos/<userId>/<uuid>.jpg", "path": "<userId>/<uuid>.jpg" }
```

### `GET /me/profile`
Fetch the full onboarding/profile payload for the current user.

Response:
```json
{
  "user": {
    "id": "uuid",
    "name": "Jane",
    "whatsapp_number": "+2348012345678",
    "role": "user",
    "onboarding_completed": false,
    "current_step": 1,
    "created_at": "2026-05-09T00:00:00.000Z",
    "updated_at": "2026-05-09T00:00:00.000Z"
  },
  "profile": { "age": 22, "build": "Athletic" },
  "preferences": { "preferred_min_age": 21, "preferred_max_age": 28 },
  "focuses": ["Getting my degree and doing well"],
  "preferred_builds": ["Slim", "Average"],
  "photos": [
    { "image_url": "https://example.com/1.jpg", "photo_type": "Profile", "upload_order": 1 }
  ]
}
```
