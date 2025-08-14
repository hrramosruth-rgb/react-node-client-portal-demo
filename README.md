# Studio Desk · React / Node client portal

An independent agency-style portfolio demo: a React workspace for fictional clients, projects, and tasks, backed by an Express API. No actual agency, employer, client engagement, or production outcome is represented.

## Simulated history

**This code was created in October 2026.** Git dates intentionally simulate a 2024–2026 development sequence, not historical work or employment. [TIMELINE.md](TIMELINE.md) maps dates to real changes made during this reconstruction. React 19.3, Express 5.2, Vite 8.3 and other pinned modern dependencies may postdate the simulated commits. Dependency choices reflect this reconstruction, not what was available in those years.

## Run locally

Node **22.12+** is required; Node 24 LTS is the CI target. Use two terminals for development:

```sh
npm ci
npm run server
```

```sh
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to the Express service on port 3001. The UI uses system fonts and needs no remote services or paid credentials after dependency installation.

To serve the compiled UI and API together:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:3001**. `PORT` changes the production server port. Development uses the documented ports; changing them also requires updating the Vite proxy and `DEV_ORIGIN` (default `http://127.0.0.1:5173`). The server binds to loopback for this local demo.

### Public demo accounts

All three accounts use **`demo-portal`**. These are intentional public fixture credentials, not secrets or real user accounts.

| Email | Access |
| --- | --- |
| `north@demo.test` | North Studio's fictional projects and tasks |
| `south@demo.test` | South Workshop's fictional projects and tasks |
| `agency@demo.test` | Both clients; create a project for either client |

Start with North to add a task, start it, and complete it. South demonstrates an initially empty task workspace. Agency can create projects. The client directory shows only clients the signed-in user can access. A completed task is terminal; an in-progress task can return to to-do.

## API contract

Responses use JSON. Errors are `{ "error": "actionable message" }`. Request bodies are limited to 8 KB; task titles and project names are trimmed and limited to 120 characters. Unknown extra fields do not change ownership. The server derives tenant, client, and role from its session; arbitrary identity headers have no effect.

| Method / endpoint | Request / response |
| --- | --- |
| `GET /api/health` | Public `{status, demo}` health check |
| `POST /api/login` | `{email, password}` → `{user}` and an HttpOnly session cookie |
| `GET /api/me` | `{user}`; requires login |
| `POST /api/logout` | Revokes current session; 204 |
| `GET /api/clients` | `{clients}` scoped to session ownership |
| `GET /api/projects` | `{projects}` including each project's tasks |
| `POST /api/projects` | Agency only: `{clientId, name}` → `{project}`; 201 |
| `POST /api/projects/:id/tasks` | `{title}` → `{task}`; 201 |
| `PATCH /api/tasks/:id` | `{status}` → `{task}` |

Valid transitions: `todo → in_progress`, `in_progress → todo`, and `in_progress → done`. Invalid status values return 400, disallowed transitions 409, missing or inaccessible records 404, absent/expired sessions 401, and client attempts to create projects 403. JSON errors and disk errors return safe messages without stack traces.

Creation endpoints accept an optional `Idempotency-Key` header with 8–128 letters, digits, underscores or hyphens. The React forms send UUID keys and retain them while retrying unchanged input. Matching retries return the original creation result, including after server restart; changed input under the same actor/scope/key returns 409. The most recent 1,000 creation keys are retained. PATCH is transition-based; repeating a successful transition returns 409. Sending a new key intentionally creates another record.

```sh
curl -c /tmp/portal-demo-cookie -H 'Content-Type: application/json' \
  -d '{"email":"north@demo.test","password":"demo-portal"}' \
  http://127.0.0.1:3001/api/login

curl -b /tmp/portal-demo-cookie http://127.0.0.1:3001/api/projects

curl -b /tmp/portal-demo-cookie -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: example-task-001' -d '{"title":"Review the content"}' \
  http://127.0.0.1:3001/api/projects/website/tasks
```

## Architecture and persistence

- `src/main.jsx`: session bootstrap, project/client views, task controls, agency project form, explicit loading, empty, success and error states. Untrusted titles render as React text.
- `server/app.js`: Express JSON boundary, public fixture login, random session tokens, safe errors, and static production assets.
- `server/domain.js`: ownership checks, input validation, task state machine, request deduplication, and atomic JSON persistence.
- `tests/`: real domain and HTTP integration tests using isolated temporary directories.

On first start, `data/portal.json` is seeded with fictional clients, two projects, and two tasks. All mutations use a cloned candidate state; the file is written to a temporary sibling and atomically renamed before the live memory changes. Failed writes cannot claim a successful mutation. Data, dependencies, environment files and build output are ignored by Git. To reset fixtures, stop the server, delete **only** `data/portal.json`, then restart.

Sessions are server-side and expire after eight hours. Restarting the server signs users out but preserves project/task data. Cookies use HttpOnly and SameSite Strict. Mutation requests with an Origin header must match the server origin or the explicit development origin. `COOKIE_SECURE=true` enables Secure cookies when using HTTPS. No password hash or password is returned by the API or written into the data file.

## Verification

```sh
npm test
npm run build
npm run format:check
npm audit
```

Verified locally: **15 tests passed** (8 domain, 7 HTTP integration); the production Vite build and formatting check passed. npm audit reported zero known vulnerabilities for the installed dependency graph at verification time. CI runs the suite and build on Node 24. Tests cover ownership isolation, identity-header rejection, missing records, validation including malformed status arrays/prototype names, transitions, logout/expiry, cross-origin write rejection, restart persistence, failed-disk rollback, and five concurrent retries creating one durable task.

A headless Chromium smoke check verified login, task creation/start/completion, agency project creation, South client isolation and its empty state, and no page errors. Desktop (1440 px) and mobile (390 px) screenshots were inspected; the mobile page had no horizontal overflow. This was a smoke check using an environment-provided Playwright runtime, not a committed browser test suite or a full keyboard/accessibility audit. CI has been configured but its hosted run is unverified until this repository is published.

## Deliberate demo limits

This is a single-process, local demonstration with shared public credentials. It does not implement production account provisioning, password recovery, MFA, login rate limiting, a distributed session store, multi-process database transactions, audit logs, backups, pagination, project deletion, or file uploads. Synchronous file persistence is suitable for this small fixture dataset; do not run multiple processes against the same JSON file. Atomic rename guards normal write failures, not every power-loss durability scenario. Loading a corrupted data file fails startup rather than silently resetting it. A retry-key retention limit means old evicted keys can create new records.

Production deployment would require real authentication, secrets, HTTPS, a transactional database, stronger operational controls, and independent security review. The public demo login is not a production security claim.

MIT licensed.
