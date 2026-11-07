# Crowd Control

HackTrent 2026!

An npm workspace for the TypeScript app and a Cargo workspace for the Rust engine.
Use Node 24+, npm 10+, and Rust with edition 2024 support.

```text
contract/   Strict Zod schemas, shared types and JSON fixtures — C leads, everyone reviews
compiler/   Layout generation, maps, rasterization, placement — B
engine/     Rust library; future simulation core and Wasm bridge — A
history/    Intervention revisions and replay planning — C
server/     Node API; future planner and persistence adapters — C
web/        React + Vite UI — B, with C owning chat
docs/       Existing local PRDs, contracts, roles and tech stack
```

## Setup

```sh
npm install
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

The initial API exposes `GET http://127.0.0.1:3001/health`.
Copy `.env.example` to `.env` to change PORT. Service credentials are optional
placeholders; no Gemini, database or Auth0 integration is implemented.

## Checks

```sh
npm run check
npm run lint
npm test
```

`check` runs TypeScript checks, Rust formatting and Cargo checking. `build`
builds all npm workspaces and the native Rust library. `test` runs the shared
contract tests and Cargo's test harness. Simulation physics/replay tests remain
pending. Commit both package-lock.json and Cargo.lock.

See [contract/README.md](contract/README.md) for contract imports, validation
boundaries and remaining engine/adapter work.
