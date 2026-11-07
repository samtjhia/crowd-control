# Crowd Control

HackTrent 2026!

An npm workspace for the TypeScript app and a Cargo workspace for the Rust engine.
Use Node 24+, npm 10+, and Rust with edition 2024 support.

```text
contract/   Strict Zod schemas, shared types and JSON fixtures — C leads, everyone reviews
compiler/   Layout generation, maps, rasterization, placement — B
engine/     Rust operations, scheduling, goals, movement, navigation and Wasm bridge — A
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
and `POST /api/plan`. Vite proxies `/api` requests to the local Node server.
To use Gemini, copy `.env.example` to `.env` and set `GEMINI_API_KEY` and
`GEMINI_MODEL` there; never put the API key in a `VITE_` variable or share it
in chat. Set `DATABASE_URL` in the same root `.env` to enable Tiger Data.
On startup, the server creates the run, intervention, and metric tables and
turns the metric table into a Timescale hypertable. The offline mock writes
run metadata, batches metric samples, and records worker-acknowledged
interventions in the background. Generated scenario plans are previews only:
the compiler handoff is not connected yet. Auth0 is not implemented.

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
That mode runs movement, goals, arrivals, rules and live changes; metrics/contact
physics/replay remain pending. The preset is explicitly movement-only.

See [contract/README.md](contract/README.md) for contract imports, validation
boundaries and remaining engine/adapter work.
