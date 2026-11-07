# Web

React + Vite app. Run `npm run dev` at the repository root.
The shared contract is built automatically before the dev server starts, and
Vite proxies `/api` requests to the local Node server.

B owns the shell, renderer and controls; C owns chat. The chat sends prompts to
the server-side Gemini planner and validates its replies against the shared
contract. Set `GEMINI_API_KEY` and `GEMINI_MODEL` in the root `.env` file; never
expose the key through a `VITE_` variable. The offline sample can be previewed
and loaded in the mock worker. Gemini-generated plans remain previews until the
compiler handoff is connected. Mock output is development data, not a safety
assessment.

After a follow-up is applied, its prompt, validated request, and worker
acknowledgement are saved in browser local storage and shown as an interaction
log after the sample is loaded again. The log does not restore or replay the
mock simulation; the simulation itself resets when the page is refreshed.

Scenario planning and running-simulation follow-ups use separate inputs. The
offline sample preview remains visible after loading, and the follow-up form is
shown directly inside the mock simulation panel.

The picker’s school and concert alarms select agents explicitly and depart them
on reaching assembly/outside zones. “Hackathon arrivals” means entering the hall
and wandering, without queue/service behavior. Use `/sim?engine=real` for Rust;
`npm run dev` rebuilds Wasm before serving. Reset after changing engine versions.

### Live rendering and playback responsiveness

- Hide `departed` agents immediately, destroy their sprites/labels, and exclude
  them from interpolated display positions. Keep runtime records for metrics and
  replay; live exit views do not show gray ghost occupants. Reset restores agents.
- Retain figure artwork across poses. After drawing, evict unused textures beyond
  6,000 entries or 128 MiB; protect textures referenced by visible sprites. The
  budgets are soft when the visible working set alone exceeds them. Avoid global
  cache clears and accumulated retired textures during animation/zoom changes.
- Automatic Rust playback uses at most 8 ticks per dispatch and measured tick cost
  to target 12 ms of work. Keep unprocessed tick debt and yield between batches;
  pause must not wait behind a 400-tick catch-up call. A single expensive Rust tick
  cannot be preempted. Slow hardware may lag the requested speed without skipping
  simulation time. Public manual step/run_to limits remain unchanged.

Regressions cover departure/reset, sprite destruction, repeated cache churn and
large zoom textures, preserved playback debt, and expensive-tick batch reduction.

### Current movement and rendering (v8.3)

- Blend downhill flow directions in open space; retain validated near-goal,
  terrain and delayed-portal waypoints. Door guidance uses the full body-clear
  opening and aligns sideways without sending agents backward. Swept collision,
  one-way, stop-distance and queue/interaction constraints remain enforced.
- Hard-exclusion motion advances front agents first, rotating ties. Predict
  followers against already-updated neighbour velocities; contact solving keeps
  its simultaneous order. Empty contact scenes can continue advancing.
- Demo wandering is indefinite and refreshes targets every six seconds, including
  arrivals after reaching the hall. An explicit no-goal/clear-goal means idle.
- Reuse Pixi geometry across moving/waiting/idle/reacting transitions. Pose changes
  animate; meaningful annotations and appearance changes still restyle. Alarm
  pulses animate opacity, without a map-sized animated shadow.
- Prepare common-radius clearance at load and skip unused reach-distance grids.
  Wasm asset URLs include the engine version. Rebuild and fully reload to update
  Rust; Reset only restarts the loaded instance.

Regressions check two body-width lanes through a one-unit door, zero graphics
rebuilds for 1,000 stop/start transitions, and continuing hackathon wandering.
School classrooms must clear by 60 s and all 192 people by 120 s. Concert seeds
7/99 must increase departures at each 30 s sample after 90 s and finish by 300 s.
Seed 42 traces clear school by 120 s and concert by 240 s. These are liveness
checks, not calibrated real-world evacuation times.

Browser FPS is unverified: local-server binding is blocked in this session.
The 2,000-agent benchmark remains near/below 4× compute budget: 78.9 ticks/CPU s
without contact, 65.8 with contact; 80 required, excluding transfer/rendering.
JSON bridging/validation remains costly; full performance acceptance is pending.
