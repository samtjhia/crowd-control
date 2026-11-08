# Web

React + Vite app. Run `npm run dev` at the repository root to start both Vite and
the API. Use `npm run dev:web` for frontend only with a separately managed API.
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
- Automatic Rust playback uses at most 4 ticks per dispatch and measured tick cost
  to target 12 ms of work. Visual catch-up is capped so agents never advance in
  perceptible jumps after expensive ticks. Keep unprocessed tick debt and yield between batches;
  pause must not wait behind a 400-tick catch-up call. A single expensive Rust tick
  cannot be preempted. Slow hardware may lag the requested speed without skipping
  simulation time. Public manual step/run_to limits remain unchanged.

Regressions cover departure/reset, sprite destruction, repeated cache churn and
large zoom textures, preserved playback debt, and expensive-tick batch reduction.

### Current movement and rendering (v8.5)

- Flow fields cache the next portal. In visible rooms, reach goals steer directly
  toward the nearest point across its body-clear opening, including from farther
  than eight grid steps away for wide openings. Narrow doors keep their existing
  approach. Preserve each person's lateral
  lane. Hidden doors retain field routing; terrain, delays, one-way access, stop
  distances and queue/interaction constraints still apply. Timed doors preserve
  lateral lanes after their entry wait, avoiding centre-waypoint jams inside them.
- Long planning rays check a strip of cells with exact swept-disc checks. Physical
  collision checks remain unchanged. No per-frame random jitter or overlap is added.
- Reach goals aimed at gates also use separate points across the opening. When
  traversing an intermediate gate, continue past its far edge before turning.
- School/concert alarm rules use seeded 0.5/1.5/2.5 s wait cohorts followed by
  evacuation at normal walking speed. These are authored demo behavior, not an
  engine-wide panic response. At 8×, eight simulated seconds pass per wall second.
- Real metrics messages include `completed`. It is true only when agents have
  departed or finished finite goals (with empty goal queues), and no runtime work
  remains. Idle/no-goal agents, blocked goals, future jobs, active rules and endless
  wandering prevent completion. Automatic playback stops, discards leftover clock
  debt and shows Complete; reset or new work allows another run. Manual stepping
  and `run_to` retain their explicit clock semantics.
- Restore the alarm glow with a static shadow and opacity-only pulse, plus a
  persistent screen-centred alarm banner. The completion banner replaces it.
- Pixi requests high-performance WebGL and renders uncapped on browser animation
  frames; only the heatmap has a 30 Hz cap. Debug mode measures browser RAF FPS
  separately from Pixi FPS. The 60 FPS target still needs a real browser measurement;
  browser/device power settings and GPU load can limit either rate.
- Hard-exclusion motion advances front agents first, rotating ties. Predict
  followers against already-updated neighbour velocities; contact solving keeps
  its simultaneous order. Empty contact scenes can continue advancing.
- Demo wandering is indefinite and refreshes targets every six seconds, including
  arrivals after reaching the hall. Recheck target visibility and immediately
  resample when furniture blocks it; crowd avoidance alone does not cause a
  resample. An explicit no-goal/clear-goal means idle.
- Walking animation and marker headings use displacement between consecutive
  engine frames, independently of camera movement, zoom or per-paint distance.
  A tick ending in waiting can still animate its measured movement. Repeated
  paints retain walking between worker updates; stale frames settle to standing.
  Reset/rewind stream changes never count as movement.
- Reuse Pixi geometry across moving/waiting/idle/reacting transitions. Pose changes
  animate; meaningful annotations and appearance changes still restyle. Alarm
  pulses animate opacity, without a map-sized animated shadow.
- Prepare common-radius clearance at load and skip unused reach-distance grids.
  Wasm asset URLs include the engine version. Rebuild and fully reload to update
  Rust; Reset only restarts the loaded instance.

Regressions check distinct distant doorway approach headings, two body-width
lanes through a one-unit door, blocked wander target recovery, zero graphics
rebuilds for 1,000 stop/start transitions, and continuing hackathon wandering.
School classrooms must clear by 60 s and all 192 people by 120 s. Concert seeds
7/99 must increase departures at each 30 s sample after 90 s and finish by 300 s.
Seed 42 traces clear school by 120 s and concert by 240 s. These are liveness
checks, not calibrated real-world evacuation times.

Browser FPS is unverified: local-server binding is blocked in this session.
The 2,000-agent benchmark remains near/below 4× compute budget: 78.9 ticks/CPU s
without contact, 65.8 with contact; 80 required, excluding transfer/rendering.
JSON bridging/validation remains costly; full performance acceptance is pending.

Playback after expensive ticks: retain owed simulation ticks, but cap spendable
wall-clock credit to one nominal 60 Hz update plus its fractional tick. Old debt
cannot cause sustained movement above the selected speed; it remains queued until
processed or an explicit reset/seek clears it. This deliberately allows simulation
time to fall behind wall time under load. Manual step/run_to are unchanged.
Walking poses follow interpolated simulation time, so 8× playback also advances
walking cadence 8×. Repainting an unchanged frame does not advance the gait.

Seeking (v8.7): keep up to 32 checkpoints spread across recorded time, with
recent points two simulated seconds apart and a one-million-grid-cell storage
budget. Cache successful seek destinations for repeat jumps. Older intervals
are thinned instead of deleting the entire early timeline. The slider previews
locally while dragging; release or Go performs one exact engine restore.
Long gaps on large maps can still require replay; no physics ticks are skipped.

Local Wasm seek benchmark (430 concert agents, 180 s recorded): seeking to
90.05 s improved from 7,178 ms to 155 ms; repeating 30.05 s took 19 ms.
These measure engine dispatch, excluding browser rendering and transport.

Wide gates (v8.12): compare up to eight crossing points using travel length and
nearby congestion, with a per-tick summed occupancy grid. Every alternative still
goes through the portal; no retreat/rally waypoints. Preserve near-threshold lanes,
narrow/timed-door semantics, one-way access, terrain costs and physical collisions.
A clear direct velocity stays first. When it is obstructed, compare safe passing
velocities on goal progress while retaining the separation preference. Regressions
cover overtaking a slow leader then reaching the original goal, passing a wall-side
queue through free gate width, and all worked-example evacuees actually departing.

Dense groups keep coordinated separation steering when both passing sides are
blocked. The v8.12 concert seed-42 trace, 430 agents: departures 148 at 90 s, 290 at 120 s, all 430 at 180 s
in the local Wasm trace. This is a liveness regression, not a calibrated prediction.

Gate routing (v8.16): wide-gate approaches compare short routes across usable
width, scoring distance plus crowd occupancy along the approach and at the gate.
Lookahead is two seconds of preferred walking, at least six body radii; lateral
changes are bounded by that distance. Occupancy uses at most twelve approach samples
and one gate query per candidate; slower people cost more. A short waypoint lets agents
go around a clump before returning toward their destination. Wall-corner approaches
still turn through open space. Geometry, portal permissions, physical speed and
collision checks remain authoritative; timed queues retain their admission waits.

Zone arrival requires the full body inside its mask. An agent partly across the
boundary seeks a nearby body-safe interior point instead of turning back toward
a shared cell centre. The next sequence goal then starts normally, including
wander. Bare reach goals stop; no goal is silently replaced with wandering.

Seed-42 alley runs and multi-seed concert runs check progress and full clearance;
post-arrival checks verify actual movement and evolving wander RNG. These are
liveness checks, not calibrated travel-time predictions.

Hackathon demo: arrivals pass the timed check-in portals, reach the hall, then
wander indefinitely. They do not visit a table or dwell for 60 seconds. Working
hackers choose tables using seeded random selection, work for 300 seconds after
arrival, then wander. Snack visitors roam after their three service/wander cycles.
These are explicit scenario goals; the engine does not change nearest selection
or turn arbitrary completed goals into wandering.

General traffic steering (v8.17): every moving agent rechecks its route each engine
tick, including ordinary reach, wander, follow, avoid and travel toward activities.
It compares nearby bypasses using distance-to-goal and the local walking-speed
deficit relative to its desired pace. Clear traffic keeps the original route.
This works on maps with no portals and on unnamed walkable floor; gate-specific
approach routing remains available. A bypass must reduce remaining goal cost,
stay in the current floor zone and pass body-clearance checks. It cannot cross a
portal to evade admission rules. Agents finish nearby waypoints before detouring,
so door-entry waits and arrival transitions cannot be skipped or orbited.

Queue tickets, occupied interaction slots, reaction delays and explicit dwell
waits retain their order/timers. Crowds are sampled once per tick; stored sample
positions/speeds exclude the subject's own contribution even across substeps.
These samples are derived caches; original goals and snapshot contracts are unchanged.

v8.17 local 2,000-agent worker benchmark: about 77 ticks/s with scheduled work
(80 required for 4×), about 65 with contact/sensors. Browser render FPS is unmeasured;
the 2,000-agent 4×/60 FPS performance target remains unmet in this benchmark.

Production feature flag: root `.env` accepts `PROD=TRUE` or `PROD=FALSE` (default).
TRUE hides Gemini assistant/planner/report UI and makes the API reject planner and
report-generation POSTs with HTTP 403. FALSE restores the normal features; keys are
still required. Invalid values fail startup/build. Restart dev servers after edits;
rebuild the frontend and restart the API for deployments. Cached report reads and
ordinary simulation, editor, saved-scenario and run APIs do not invoke Gemini.

Playback speed is a worker-session preference: reset, rewind/seek and loading a
new scenario preserve the selected multiplier. They clear playback debt and pause
as usual; loading also uses the new scene's timestep. A new worker starts at 1×.
The speed selector and actual worker pacing therefore remain in sync.
