# Integrating the Backend “Demo‑Date” Endpoint into the Frontend Hero Component

**Audience:** Front‑end developer (owner of the separate GitHub repo that builds the UI).
**Purpose:** Enable the countdown on the Hero section to be driven by a date supplied by the backend, while preserving the existing ability to override via a URL query parameter.

---

## 1️⃣ What has been added on the backend

**File:** `src/app.js`
```js
import "./env.js";
import dotenv from "dotenv";
dotenv.config();                       // Load .env variables

// … existing imports and app creation …

export function createApp() {
  const app = express();

  // … existing middleware …

  app.use(routes);
  app.use(errorHandler);

  // ------------------------------------------------------------
  // Demo‑date endpoint
  // GET /api/demo-date → { "demoDate": "2026-11-09T19:00:00.000Z" }
  // The date can be overridden by the env var DEMO_DATE.
  // ------------------------------------------------------------
  app.get("/api/demo-date", (req, res) => {
    const demoDate = process.env.DEMO_DATE;
    const now = demoDate ? new Date(demoDate) : new Date();
    res.json({ demoDate: now.toISOString() });
  });

  return app;
}
```
- **URL:** `http://<backend‑host>:4000/api/demo-date` (port 4000 in dev, whatever you configure in production).
- **Response:** JSON `{ "demoDate": "<ISO‑8601 string>" }`.
- **Control:** Set `DEMO_DATE` before starting the server to force a particular date, e.g.
  ```powershell
  $env:DEMO_DATE = "2026-11-09T19:00:00Z"
  npm run dev
  ```

---

## 2️⃣ What the frontend needs to do (tiny change)

Only **four lines** of new code are required.

### 2.1 Add a helper to fetch the demo date
Create a small utility (e.g., `utils/demoDate.ts`):
```tsx
export const fetchDemoDate = async (): Promise<Date | null> => {
  try {
    const resp = await fetch("/api/demo-date"); // relative to the same host
    if (!resp.ok) return null;
    const { demoDate } = await resp.json();
    return demoDate ? new Date(demoDate) : null;
  } catch {
    return null;
  }
};
```

### 2.2 Update the `getNow` function (make it async)
```tsx
import { fetchDemoDate } from "./utils/demoDate"; // adjust path as needed

// Keep the original query‑param behavior for backward compatibility
const getNow = async (): Promise<Date> => {
  const params = new URLSearchParams(window.location.search);
  const queryDemo = params.get("demoDate");
  if (queryDemo) return new Date(queryDemo);

  const backendDemo = await fetchDemoDate();
  return backendDemo ?? new Date(); // fallback to real current time
};
```

### 2.3 Adjust the `useEffect` to await the async call
```tsx
useEffect(() => {
  const calculateTimeLeft = async () => {
    const now = await getNow();   // <-- note the await
    const nextFriday = new Date(now);
    // ... existing countdown logic ...
  };

  calculateTimeLeft();                     // run once immediately
  const interval = setInterval(calculateTimeLeft, 1_000);
  return () => clearInterval(interval);
}, []);
```
> **Only a few lines changed** – the rest of the component stays exactly the same.

---

## 3️⃣ Testing Locally
1. **Start the backend** (with optional demo date):
   ```powershell
   cd "C:\Users\ojoje\OneDrive\Desktop\My project\minglee\Minglee"
   $env:DEMO_DATE = "2026-11-09T19:00:00Z"   # optional
   npm run dev
   ```
2. **Start the frontend** (your existing repo):
   ```powershell
   cd "<path‑to‑frontend‑repo>"
   npm install   # first time only
   npm run dev   # Next.js → http://localhost:3000
   ```
3. **Open the page**:
   - Without query param: `http://localhost:3000` → countdown uses the backend date.
   - With explicit param (for ad‑hoc testing): `http://localhost:3000?demoDate=2026-11-09T19:00:00Z` → query param wins.
4. **Inspect Network** in Chrome DevTools → you should see a GET to `/api/demo-date` returning the JSON payload.

---

## 4️⃣ Production deployment
- The backend will expose the same `/api/demo-date` route in production (e.g., `https://api.minglee.net/api/demo-date`).
- No change needed on the frontend **if** the UI is served from the same domain (relative path works).
- If the UI lives on a different origin, update the fetch helper to use a full URL and expose the base via `NEXT_PUBLIC_BACKEND_URL`:
  ```tsx
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";
  const resp = await fetch(`${BACKEND_URL}/api/demo-date`);
  ```
  Then add `NEXT_PUBLIC_BACKEND_URL=https://api.minglee.net` to the frontend’s `.env`.
- To change the demo date in production, simply update the `DEMO_DATE` env var on the server and restart the backend. The next request from the UI will automatically pick up the new date.

---

## 5️⃣ Quick checklist for you
| ✅ | Action |
|---|--------|
| 1 | Add `utils/demoDate.ts` (or equivalent) with the `fetchDemoDate` helper. |
| 2 | Replace the existing `getNow` in `Hero.tsx` with the async version shown above. |
| 3 | Update the `useEffect` to `await getNow()`. |
| 4 | Test locally with the backend running and verify the network request. |
| 5 | Deploy – no further changes required; the endpoint works the same in production. |

---

## 6️⃣ Contact / Support
If anything is unclear or you hit an issue (e.g., CORS, different domains, or the fetch fails), just ping me. I can also add a temporary debugging route or adjust the environment variables for you.

*Document generated on 2026‑11‑01 by Antigravity (GPT‑OSS 120B).*
