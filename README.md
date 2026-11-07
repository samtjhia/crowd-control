# Crowd Control

HackTrent 2026!

An npm workspace for the TypeScript app and a Cargo workspace for the Rust engine.
Use Node 24+, npm 10+, and Rust with edition 2024 support.

```text
contract/   Strict Zod schemas, shared types and JSON fixtures — C leads, everyone reviews
compiler/   Layout generation, maps, rasterization, placement — B
engine/     Rust operations, scheduling, goals, movement, metrics and Wasm bridge — A
history/    Intervention revisions and replay planning — C
server/     Node API and Gemini planner; persistence adapters — C
web/        React + Vite UI — B, with C owning chat
docs/       Existing local PRDs, contracts, roles and tech stack
```

## Setup

```sh
npm install
rustup target add wasm32-unknown-unknown
npm run build
```

Start the frontend at the URL Vite prints:

```sh
npm run dev
```

In another terminal, start the API:

```sh
npm run dev:server
```

The API exposes `GET http://127.0.0.1:3001/health`, `GET /health/database`,
and `POST /api/plan`. With Tiger Data enabled, it also accepts run records at
`POST /api/runs`, metric batches at `POST /api/runs/:runId/metrics`, and
acknowledged interventions at `POST /api/runs/:runId/interventions`.
`GET /api/runs/:runId/analytics` returns peak density by zone and mean zone
density before and after each acknowledged intervention. It compares recorded
samples in the 10 simulated seconds before and after the intervention; missing
sides remain unavailable rather than being inferred. Vite proxies `/api`
requests to the local Node server. Authenticated `GET /api/runs` lists up to 50
recent runs owned by the signed-in user, with metric and intervention counts;
the `/history` page displays that list and selected-run analytics without
replaying simulations.
To use Gemini, copy `.env.example` to `.env` and set `GEMINI_API_KEY` and
`GEMINI_MODEL` there; never put the API key in a `VITE_` variable or share it
in chat. Set `DATABASE_URL` in the same root `.env` to enable Tiger Data.
Sign-in is required before using the app or its API. Create an Auth0
single-page application and an API, then set `AUTH0_DOMAIN`,
`AUTH0_AUDIENCE`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, and
`VITE_AUTH0_AUDIENCE` in the root `.env` (the two audience values must match).
Allow the local app origin, such as `http://localhost:5173`, in the Auth0
application's callback, logout, and web origins. The API accepts only verified
Auth0 RS256 access tokens for the configured issuer and audience; `/health`
and `/health/database` remain public. Missing server Auth0 configuration fails
closed for every `/api/*` route.
On startup, the server creates the run, intervention, and metric tables and
turns the metric table into a Timescale hypertable. The offline mock writes
run metadata, batches metric samples, and records worker-acknowledged
interventions in the background. On `/history`, users can view their saved runs
and analytics. Ask why on `/planner` sends recent in-memory
metrics, events, and applied interventions to Gemini; answers are instructed to
stay within that evidence and cite only supplied event IDs. This is a
current-session mock feature. Generated
scenario plans are previews only: the compiler handoff is not connected yet.
New saved runs are owned by the authenticated Auth0 subject. Existing anonymous
runs remain unowned and unavailable to signed-in users; they are not assigned
to the first person who logs in. Chat history remains in browser localStorage.

## Checks

```sh
npm run check
npm run lint
npm test
npm run test:wasm
```

`check` runs TypeScript checks, Rust formatting and Cargo checking. `build`
builds the Wasm module, npm workspaces and native Rust library. `test` runs
contracts, history, server, compiler, mock/real endpoint, Cargo and native
Rust/Zod compatibility tests. `test:wasm` exercises the compiled JS bridge.
Browser acceptance and simulation physics/replay remain pending. Commit both lockfiles.

The engine demo is at `/`; the planner UI is at `/planner`. The engine's PixiJS
view loads a pinned CDN bundle and needs network access.

The frontend runs the service fixture: two attendees queue/interact at a desk,
then depart; a third wanders. Playback, door controls and Stop/Recover exercise
Rust goals, movement and recorded changes. Its minimal PixiJS view needs network
for a pinned CDN bundle. See [engine/README.md](engine/README.md) for supported
inputs and limitations.

The product simulator at `/sim` defaults to the mock worker. Use
`/sim?engine=real` for Rust/Wasm with the same PixiJS UI and compiled scenarios.
That mode runs movement, goals, arrivals, rules, live changes and real metrics.
The preset is explicitly movement-only. Open `/?demo=contact` for the opt-in
physical contact and compression-fall fixture. Replay remains pending.

See [contract/README.md](contract/README.md) for contract imports, validation
boundaries and remaining engine/adapter work.
