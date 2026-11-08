# Crowd Control

**Simulate any crowd. Describe a scenario, see what happens.** Built at HackTrent 2026.

Crowd Control lets you test a venue before the crowd shows up. Upload a floor plan or pick a
demo venue, describe a situation in plain English, and watch every person move through it,
simulated individually by a Rust engine running in your browser.

- **Describe it.** Gemini turns "80 people check in at the front door" into a runnable scenario.
- **Watch it.** A live density heatmap shows where it gets dangerous, in people per m².
- **Change it mid-run.** Close a door, add a danger, make someone fall, or rewind and try a fix.
- **Learn from it.** Every run is saved to your account with an AI safety report built from its own measurements.

## Quick start

You need **Node 24+**, **npm 10+** and **Rust** (edition 2024) with the Wasm target.

```sh
npm install
rustup target add wasm32-unknown-unknown
cp .env.example .env      # then fill it in (see below)
npm run dev
```

Open <http://localhost:5173>.

`npm run dev` builds the engine, starts the API on port 3001 (or reuses one already running),
and serves the site on port 5173. Closing either one stops the other.

**Run only one of these.** `npm run dev` already includes the API, so a separate
`npm run dev:server` will fail with `EADDRINUSE` on port 3001. If you want the API to reload
when you change server code, use two terminals instead:

```sh
npm run dev:server   # API on 3001, reloads on changes to server/src
npm run dev:web      # site on 5173
```

## Configuration

Everything lives in the root `.env` (copy it from `.env.example`).

| Variable | What it does |
| --- | --- |
| `PROD` | `FALSE` turns on Gemini. `TRUE` hides the assistant, AI scenarios and AI reports, and the API refuses them (HTTP 403). Restart the API and reload the page after changing it; no rebuild needed. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini, for the assistant and reports. Never put the key in a `VITE_` variable. |
| `DATABASE_URL` | Tiger Data (Postgres + Timescale), where runs, metrics, changes, floor plans and scenarios are saved. |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE` | Auth0 for the API, which verifies sign-in tokens. |
| `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE` | Auth0 for the site. The two audience values must match. |
| `PORT`, `HOST` | Where the API listens. Keep `3001` and `127.0.0.1` locally. |

**Setting up Auth0:** create a *Single Page Application* and an *API*. In the application, add
`http://localhost:5173` to Allowed Callback URLs, Allowed Logout URLs and Allowed Web Origins.

**Setting up the database:** just set `DATABASE_URL`. On startup the server creates its tables
and turns the metrics table into a Timescale hypertable.

## Running with Docker

```sh
docker compose up --build
```

This builds the engine and the site, runs the API, and serves everything through Caddy on ports
80 and 443. It reads the same `.env`. Set `SITE_ADDRESS` to your domain for automatic HTTPS;
it defaults to `localhost`.

## How it fits together

```text
contract/   Shared Zod schemas, types and JSON fixtures: the language every part speaks
compiler/   Turns a scenario plan + venue into a scene the engine can run
engine/     Rust/Wasm simulation: movement, goals, scheduling, rules, metrics, rewind
history/    Intervention revisions and replay planning
server/     Node API: Gemini planner and reports, Auth0, Tiger Data storage
web/        React + Vite + PixiJS: landing page, simulator, editor, past runs
docs/       Product and technical specs
```

A scenario flows through it like this:

1. **You describe it.** The assistant sends your words, the venue and any points you marked to the API.
2. **Gemini plans it.** The server asks Gemini for a scenario plan in the shared contract format.
3. **The compiler builds it.** It checks the plan against the venue and produces a scene.
4. **The engine runs it.** The Rust engine runs in a Web Worker; the page draws each frame with PixiJS.
5. **The run is saved.** Metrics and changes stream to Tiger Data, ready for Past runs and the report.

| Team | Area |
| --- | --- |
| Conrad | `engine/` |
| Samuel | `compiler/`, `web/` |
| Josephine | `server/`, `history/`, `contract/` (everyone reviews) |
| Benito | Landing page |

## API

The site talks to the API through Vite's `/api` proxy. All `/api/*` routes need an Auth0 token,
except the public ones marked below.

| Route | What it does |
| --- | --- |
| `GET /health`, `GET /health/database` | Health checks (public). |
| `GET /api/features` | Whether Gemini is turned on (public). |
| `POST /api/plan` | Ask Gemini for a scenario, a change, or an answer about a run. |
| `GET /api/runs`, `POST /api/runs` | List your recent runs (up to 50), or start a new one. |
| `DELETE /api/runs/:id` | Delete a run. |
| `POST /api/runs/:id/metrics`, `POST /api/runs/:id/interventions` | Save a run's measurements and changes. |
| `GET /api/runs/:id/analytics` | Peak density by area, and density before and after each change. |
| `GET /api/runs/:id/replay` | What's needed to replay a run. |
| `GET`, `POST /api/runs/:id/report` | Read a run's saved report, or write one with Gemini. |
| `/api/venues[/:id]`, `/api/scenarios[/:id]` | Your floor plans and assistant scenarios (`GET`, `PUT`, `DELETE`). |

## Checks

```sh
npm run check       # TypeScript, Rust formatting, cargo check
npm run lint        # web lint
npm test            # every workspace, plus Rust and contract compatibility tests
npm run test:wasm   # the compiled engine through its JavaScript bridge
```

Commit both lockfiles (`package-lock.json` and `Cargo.lock`).

## More docs

- [engine/README.md](engine/README.md): what the engine supports and its limits
- [contract/README.md](contract/README.md): the shared contract and validation
- [web/README.md](web/README.md): the frontend
- [docs/](docs/): product and technical specs
