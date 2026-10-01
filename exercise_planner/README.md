# Forma

A responsive React wellness planner with a local Python/SQLite API.

## Run locally

```sh
npm install
npm run dev
```

In a separate terminal:

```sh
python backend/server.py
```

Vite proxies `/api` to port 8000. Run `npm run build` for the production frontend.

The initial dashboard is a sample workspace. Create a profile from the avatar or Customize plan. Task updates, water intake, photos, and feedback persist in the browser. When the API is running, profiles and 28-day sample plans are also stored in SQLite, with per-tenant media directories and file caches. API write endpoints require an opaque session token and derive the tenant from that token. Sessions are in memory and expire when the backend restarts.

The admin screen is a local UI prototype using the requested `admin@example.com` / `admin` credentials. It is not production authentication; users added there persist only during the current app session.

## Remaining integrations

The planner currently generates deterministic sample routines; it does not call OpenAI. Actual LLM role orchestration, bounded critique/revision, personalized calorie calculations, notifications, server media upload, durable authentication, Redis, and the Phase 2 MCP server are not implemented. Redis is a separate service, not file storage; the current cache is a local JSON file. Allergy inputs deliberately produce meal placeholders requiring ingredient review.
