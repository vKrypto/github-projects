# Forma — Phase 1

React frontend, FastAPI backend, SQLite database, tenant-scoped local media, and Redis with a persistent file-cache fallback.

## Start

From the repository root:

```sh
python -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
npm install
```

The root `.env` contains the backend key. For another machine, copy `.env.example` to `.env` and set `OPEN_API_KEY`. Secrets are ignored by Git and never bundled into the frontend.

Run in two terminals:

```sh
.venv/bin/python -m backend.server
```

```sh
npm run dev
```

App: http://localhost:5173 · API docs: http://localhost:8000/docs · API health: http://localhost:8000/api/health

Admin credentials are `admin@example.com` / `admin`, as requested. `ADMIN_EMAIL` and `ADMIN_PASSWORD` seed the administrator on the first database initialization. Subsequent password changes go through Settings. `COOKIE_SECURE=true` is available for HTTPS deployments.

## Phase 1 features

- Create an account with name/email and an optional password. If omitted, a generated password is shown once for future sign-ins. Login, logout, password changes, and sessions survive server restarts.
- Onboarding captures multiple focus areas, multiple body areas plus custom focus, mandatory food planning, dietary preferences, allergies, height, weight, age, fitness level, goals, limitations, and optional skin/hair types. Fitness-specific and care-specific fields follow the selected focus.
- Optional equipment/body images are uploaded to a private tenant folder. Equipment text and images guide the workout role; gym access is assumed when neither is supplied. Image metadata is removed and files are re-encoded to JPEG.
- OpenAI Responses API creates separate workout, meal, and optional care plans. A provider interface allows adding other LLMs. An independent review role checks the combined result; major issues return to the responsible role, with at most three revisions per role. Schema and schedule validation also feed revision requests. Unapproved plans are never published.
- A reviewed seven-day schedule expands to 28 dated days with four weekly progression instructions. Meals have portions, ingredients, steps, estimated calorie targets, and task calories. Workouts have routine steps and estimated duration/burn. Body-area focus does not imply spot fat loss.
- Selected care routines begin on day 15, or on day 1 when early care is selected. Users can start care early and regenerate.
- Planning runs in the background with persisted job status, visible progress, retryable errors, and dashboard notifications. If the process restarts mid-job, the job becomes retryable. Previously published plans remain available when regeneration fails.
- The dashboard and four-week calendar show dated tasks, detailed routines/recipes, completed/skipped/pending status, day-specific calorie and movement totals, water logs, check-ins, weight trends, completion graphs, adherence summaries, and habit feedback. Saved user feedback is passed into subsequent planning.
- Admins can create/list/delete accounts, set passwords, and enter a user’s workspace. Impersonation has an explicit return-to-admin action. Deletion removes the tenant's database records and local files.
- Database reads/writes and media endpoints derive ownership from the authenticated session. Different tenants cannot access one another’s data. Passwords use salted PBKDF2 hashes, and sessions use opaque HttpOnly cookies with hashed tokens stored in SQLite.

Daily progress photos are stored as a private journal; AI photo-progress analysis and MCP are **Phase 2**, outside this implementation.

## Configuration

`OPEN_API_KEY` is supported exactly as requested; `OPENAI_API_KEY` also works. `OPENAI_MODEL` defaults to `gpt-4.1-mini`, and `LLM_PROVIDER` defaults to `openai`. There is no fabricated or sample-plan fallback on provider errors.

Leave `REDIS_URL` empty for an atomic JSON file cache. Set it to a Redis connection URL to use Redis; the file cache handles unavailable Redis connections. SQLite remains authoritative. Data lives under `backend/data/` (override with `FORMA_DATA_DIR`).

Dashboard notifications work immediately. Email delivery needs `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and, where required, `SMTP_USER`/`SMTP_PASSWORD`. SMTP is not configured in the supplied environment. Notification records show whether email was sent, disabled, not configured, or failed; they never claim delivery when SMTP is unavailable.

Calendar dates default to `Asia/Kolkata`. The current planner supports adults aged 18–100. Calorie and burn values are estimates, with planning assumptions available in the UI.

## Validation

```sh
.venv/bin/python -m pytest backend/tests -q
npm run build
npx playwright install chromium
npm run test:e2e
```

Run the API and frontend before browser tests. The backend tests use isolated temporary databases and a controlled provider, so they do not incur API charges or send email. They cover persistent authentication, tenant isolation, uploads, task validation, admin CRUD/impersonation, background jobs, care timing, bounded review revisions, and preservation of previous plans after failures.

A live OpenAI run was also verified: 28 days, all three planning roles, approved independent review, and delayed care. Its real saved plan was exercised in the browser for task completion/skipping, all four calendar weeks, routine details, water logging, check-ins, photos, and progress charts. `tests/live-plan.spec.js` runs when a temporary live-verification account descriptor is available under `backend/data/verification.json`; otherwise it is skipped.

Implementation follows the official [OpenAI structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) and FastAPI documentation for [file uploads](https://fastapi.tiangolo.com/tutorial/request-files/).
