# Rust engine — parts one through eight

Implemented: strict loading, authoritative agents, seeded streams, fixed ticks,
snapshot export, navigation, acceleration, local avoidance, terrain slowdown and
all eight goals, static entities, FIFO/interaction service and recorded operations, jobs, rules, metrics and read-only inspection.
The TypeScript Web Worker validates commands/messages and paces Rust/Wasm; PixiJS
receives scene metadata followed by position frames. Positions stay engine-owned.
The Technical PRD governs behavior and B owns the agent-position contract.

## Run and check

```sh
rustup target add wasm32-unknown-unknown
npm install
npm run dev
```

The demo loads contract/fixtures/engine-services-load.json: two attendees queue at
an object, interact, execute nested waits, then explicitly depart. A third wanders.
Play/Pause, Step, Speed (including 8×), Reset, forward Run to time, Close/Open door
and Stop/Recover use the real worker. Reset restores the initial map/history.
The temporary PixiJS view loads a pinned 8.22.0 CDN bundle and requires network.
engine-movement-load.json covers terrain and engine-crossing-load.json crossings.

```sh
npm run check
npm run lint
npm test
npm run test:wasm
npm run build
npm run bench:engine
```

Tests cover native Rust, shared Zod schemas, actual Wasm/native message parity and
worker pacing. Browser/PixiJS rendering and the 2,000-agent/4×/60-fps target remain
unverified. `engine-static-load.json` and `engine-grid-load.json` still provide
equivalent stationary scenes. `engine-load.json` now runs scheduled arrivals and the alarm rule.

Local full check/build is currently blocked by missing declared PixiJS, Lucide and
font packages in the separate /sim UI. Installing them failed with npm registry
DNS resolution (ENOTFOUND). Engine/Wasm, contract/worker tests and lint pass.

## Navigation

- `reach` controllers accept exactly one of `targetZone`, `targetEntityId` or
  `targetIds` (1–64 static zone/portal IDs). `lowest-cost` is the default selection;
  `nearest` measures distance to body-clear destination cell centers, ignoring
  route connectivity; `random` draws once from the agent's seeded stream.
  Selection stays fixed during topology changes, including unreachable targets.
- Four-neighbor fields are shared by physical radius and destination. Uniform
  costs use BFS; varying costs use Dijkstra. Edge cost is cellSize × mean endpoint
  traversalCost. This is navigation cost, not calibrated travel time; portal waits
  are applied during movement. Direction ties are deterministic.
- Exact swept-disc checks reject edges through walls or anchored blocking bodies.
  One-way portals allow connects[0] → connects[1]. Portal boundaries need declared
  neighboring zone membership. Adjacent distinct portals need intervening floor.
- Desired speed is min(preferredSpeed × (1 + urgency), maximumSpeed) ×
  mobility.speedMultiplier × local terrainSpeedMultiplier. Reaction and portal delays consume whole fixed ticks
  (rounded up); floating-point residue cannot add another tick. `stopDistance`
  measures remaining route length, never a straight line through a wall.
- Closing/reopening a portal increments topologyVersion and sceneVersion and
  rebuilds navigation caches. Goal identity/progress, chosen destination and RNG
  survive replanning. Blocked agents keep their goal and resume when reachable.
  Completed ordinary reach goals become idle; only explicit departOnArrival counts departures.

The cell-center graph is conservative: coarse grids may reject physically possible
off-center routes. Use sufficient compiler grid resolution; the engine never
widens doors. Masks determine actual walkability rather than zone bounding boxes.
Static map.entities preserve IDs, shapes, style and components. Rectangles,
circles, simple polygons and thick lines are validated; every blocking footprint
must already be blocked in the reviewed grid. Shapes do not override masks.
Static entities are immovable and use shape instead of physical.radius. Base portal cells must be walkable; the open flag overlays
closure without deleting the original wall mask. Calibrated source metadata and
world units are preserved; source transforms are never applied twice.

Bounds: 2,000 agents, 1,000,000 map cells, 4,000,000 navigation cache cells,
64,000,000 work units per cache build or movement tick, and 256 movement substeps
per tick. Oversized desired travel is rejected; failed batches restore all agents
and the tick counter.

## Movement and terrain

Local steering uses personal-space repulsion and predictive right-side passing.
A flat bucket index limits neighbor searches. Movement integrates acceleration
and subdivides ticks so each substep travels at most 0.25 cell. Swept discs check
walls and relative agent motion; axis sliding or a stop resolves blocked motion.
Collision stops and waypoint/goal limits may override acceleration for exclusion.
This is best-effort avoidance; crowded or opposing narrow flows can still wait.
These steering checks alone produce no contact forces. The opt-in part-eight
solver below supplies physical normal impulses.

grid.terrainSpeedMultiplier is optional: one finite Float32 value in (0,1] per
cell, indexed y*width+x. Missing values default to all 1; snapshots/render scenes
include the resolved array. A value of 0.5 halves desired speed; normal desired
speed returns on exit, subject to acceleration. The fixed dt never changes.
Zero-speed terrain is rejected; use blocked cells for impassable areas.
traversalCost remains independent and does not slow walking.

Zero agent mobility anchors the existing disc, suspends goals/timers and sets
velocity to zero. Recovery restores positive mobility and replans with the same
goal, chosen destination and RNG. Initial overlap and occupied door closure fail
without teleportation. Both blocking agents exclude each other; nonblocking
agents ignore agent collisions but still respect walls.

## Live operations, jobs and rules (part six)

`operations-engine-v6` implements all ten operations through one executor. Live
requests, compiler jobs and rule actions validate the same nested patches and
commit complete batches, including RNG, allocations, events, geometry and claims.
`set` accepts nested allowlisted component/appearance scalars, never dotted keys,
positions, geometry or arbitrary JSON. A style-only change leaves topology,
positions, goals and per-agent RNG intact. Invalid resulting components fail.

Selectors support IDs/kind/all requested tags/exact label, allowlisted predicates,
`inside`, `near`, and count/fraction samples. Filters combine with AND. Matches
start in stable ID order; sampling uses an origin-specific seeded stream stored
in `random.ruleSampling`. Fractions round down. Empty mutation matches fail with
NOT_FOUND; count conditions may count zero. Retained departed records remain
selectable by explicit ID/state; they cannot be revived or assigned goals.
Selectors describe an entity by its position (static shapes use their centre);
region membership and distances use reviewed masks, not a bounding-box route.

Future placement resolves selectors and checks current occupancy when due. The
v6 policy samples body-safe grid cell centres, shuffles equal choices with the
placement stream, and retains model spacing between new agents. `inside` requires
full-body zone membership; optional distance adds an inset. `near` permits points
within distance of a target; `along` also keeps the body outside it. The default
near/along/away distance is model bodyDiameter × spacingDiameters. `edge` prefers
the specified extreme of feasible candidates; `awayFrom` adds radius to clearance.
Count never shrinks to fit. Explicit shape plus placement validates both; edge
validation permits at most one model spacing from the requested regional edge.
A placement-only static add uses a square of max(model bodyDiameter, cellSize), with no invented
building dimensions. Supply a compiled shape for larger objects.

Static additions rasterize their actual rectangle/circle/polygon/thick_line shape;
blocking masks, zones and portal membership rebuild atomically. Source cells and
other overlays survive removal. Initial object floor underlay is identified by
named zone membership; unzoned source wall cells remain permanent. A new zone
labels existing floor; it does not erase walls. Portal geometry is an explicit
opening. Removing a destination marks affected current/queued goals NOT_FOUND
and releases claims. Removing a connected zone requires removing its portals first.

Jobs run at the first boundary at/after their absolute time. `after` is relative
to the enclosing batch's actual execution time. Load dispatches time-zero work;
each completed movement tick dispatches due jobs before the following tick moves.
Due jobs order by dueTick then registration order. Events dispatch to registered
rules; time/count predicates evaluate at boundaries and after live changes.
Rules default to once; repeating rules need positive cooldown, rounded up to ticks.
Zero-delay children and emitted events drain at the same boundary within budgets.
A failed due batch is discarded and logs job_failed/rule_failed with its error and
origin; a failed rule attempt consumes its once/cooldown. A cascade-budget failure
rolls back the enclosing live request or advance command. No historical event is
re-delivered to a newly registered rule.

Compact compiler spawns expand to normal templates/placements; controller rules
expand to live selectors plus their referenced compiled goal. The compiler now
preserves reach.departOnArrival. Runtime snapshots include pending jobs, definitions,
firing/cooldown state, rule sampling streams and entity origins. Base work uses
origin {interventionId:"base", revision:1}, tied to initialSceneHash. Generated
entities/jobs/rules/events inherit their intervention revision and immediate
parentJobId/parentRuleId. These are ownership records, not editable-history support.

create_intervention accepts now/future times and deduplicates exact request content,
including failed outcomes. Changed content under the same ID fails. Newly created
past work, edit/delete and restore/replay remain rejected. Scheduled spawns/removals
and style changes publish scene metadata before frames at their new scene version;
events are delivered once per publication stream to the existing frontend client.

Bounds: 100 operations/batch, nesting 8, selector depth 4, 64 million selector or
placement work units, 1,000 pending jobs/rules, 100 dispatches/boundary, 10,000
operations/boundary, 10,000 allocated jobs/selector streams/reservation groups,
20,000 lifetime entity IDs, 10,000 retained events and 2,000 retained agents.
Failures are explicit rather than silently truncating work.
Density and entity_metric rules now work with their respective metrics/sensors.
Unbound subjects and unavailable contact sensors reject registration.

## Metrics and read-only queries (part seven)

`metrics-engine-v7` uses policy `metrics-v1` (schema/ABI 1). Inventory, agents,
events, metrics and history queries are implemented. Query filters use inclusive
simulation-time bounds; metrics use a time index and optional zone filtering.
Agent queries accept live selectors and deterministic private sampling; no query
changes simulation RNG, allocations, history, metrics or events. Filter lists allow
4,096 IDs. Oversized replies return RESOURCE_LIMIT (900,000 values / 31 MiB);
use narrower time windows/selectors rather than truncating retained data.

Present includes immobile agents and excludes departures/removals. Departed and
removed are independent cumulative counts: removing a departed record does not
erase its departure. Blocked includes unreachable agents and movement-obstructed
waiters. Zone occupancy uses agent centres and actual zone masks; density is
occupancy / usable unblocked mask area, including static object exclusions.

The local grid is `cell-centre-v1`: each present agent contributes one person to
its current walkable cell, divided by cellSize². Walls read zero. Units are
people/m2 only on metre maps; model maps use people/model-unit2. This raw estimator
is separate from the frontend's interpolated Gaussian visualization. Density rules
use aggregate occupancy / usable area across selected zones, evaluated at each
fixed boundary and after live changes. No matching/usable region means no firing;
non-zone matches are invalid. Density never supplies contact load or triggers falls.

Portal throughput counts a completed passage from one connected zone, through
portal cells, into the other zone. Movement substeps record the actual path;
entries, U-turns and starts inside a doorway without a known origin do not count.
`crossed` is cumulative; `flowRate` counts passages in (now−1s, now], per second.
Snapshots include `metrics.portalVisits` for unfinished passages, plus crossing
history. Queue totals count successful admissions, cumulative/max admitted waits
(now − joinedAt), and current ticket count. Cancellations do not count as served;
current pending waits remain inspectable through queueRef.joinedAt.

Clearance is opt-in, in compiled scene JSON (not a new LLM primitive):

```json
"clearance": {"cohortIds":["a1","a2","a3"],"startedAt":10}
```

IDs are finite, nonempty and unique; declared future IDs may be included. Omission
leaves t50/t90/t100 null. Each threshold is the earliest time the required share
of this cohort has departed, relative to startedAt (already-out members contribute
zero). Missing, removed-without-departure and unrecovered members keep the relevant
threshold incomplete. Future arrivals are not silently added to the denominator.
engine-load.json declares its two initial people plus the scheduled third person.

History retains tick zero, then every ceil(0.5/dt) ticks, after due work/rules.
Live metric messages use the current frame's complete stamp and current counts;
they can be newer than the most recent retained history point. Density is sent on
load/reset/scene changes and at most once per history period during ordinary steps.
The client retains that grid between updates and rejects stale streams/versions.
Local density and usable-area caches rebuild deterministically from snapshot state.

History is not truncated at the mock's 2,000 samples. The explicit retention budget
is 100,000 total sample/detail/crossing records; exceeding it returns RESOURCE_LIMIT
and rolls back the entire command. Retained event queries cover the existing
10,000-event budget. Export/query before reset if a run reaches these limits.
Public restore/replay is still part nine. Contact sensors remain null without an enabled solver; part eight provides it.

## Physical contact and compression rules (part eight)

`contact-engine-v8.1` registers `disc-impulse-v1`. Contact remains opt-in through
resolvedModel.contact; unknown solver versions are rejected. Example model config:

```json
{"solverVersion":"disc-impulse-v1","referenceLoad":2,"forceUnits":"model-force",
 "parameters":{"mass":1,"iterations":96,"tolerance":1e-8,"maximumSpeed":2}}
```

The solver constrains disc velocities with frictionless, inelastic normal impulses.
It detects swept person/person and person/grid-wall contacts, including map edges;
iterative constraints transmit pushes through movable bodies. Idle people can be
pushed. Zero mobility or physical.movable=false gives an anchored body. Walking
intent still uses navigation/avoidance; only physical contact constraints contribute
to sensors. Physical pushes may displace an agent from its intended local route.
The body remains a disc when fallen; there is no stacking, deformation or friction.
Close passes without a swept collision produce no impulse, even with a loose
numerical tolerance.

contactLoad = sum of this tick's nonnegative normal impulses / dt;
contactLoadRatio = contactLoad / referenceLoad. Opposing contacts add. No solver
means null sensors/state. An enabled solver starts with null sensors and supplies
measured zero/nonzero after each completed tick. forceUnits=N requires metre
geometry and mass in kg; model-force uses model units. referenceLoad is a model
scale, not a validated injury threshold. Parameters are required and strict:
mass [1e-9,1e6], iterations 1..128, tolerance (0,0.001], maximumSpeed (0,100],
referenceLoad ≥1e-12, dt [1e-6,1]. Configured walking maxima must fit maximumSpeed.
Substeps cap travel at 0.25 cell. Nonconvergence, excessive speed or work returns
RESOURCE_LIMIT and rolls back positions, sensors, solver state, rules and jobs.
Bounds: 256 substeps/tick, 64 million combined movement/contact work units/tick, 100,000 diagnostic
impulses/tick. This is a behavioral model, not calibrated injury prediction.

entity_metric supports contactLoadRatio only when this solver is enabled. Select
mobile, movable, non-departed agents after completed ticks. Track heldTicks,
fired and nextEligibleTick per rule/agent. Missing/below-threshold/ineligible
samples reset dwell; once-only firing survives recovery. The fixed-clock rounding
is shared with schedules; for=0 still requires one completed sample. Repeating
rules need a positive per-agent cooldown. Density and proximity never supply a
contact sample, and there is no spreading-fall probability or automatic healing.

Sample tick N queues captured actions with dueTick=N+1. That boundary applies
eligible actions before its following movement interval. Pending sensor actions
carry subjectId and skip removed, departed or immobile subjects. Scheduled children
capture explicit IDs and run normally, allowing an explicitly authored recovery.
Sensor-owned schedule IDs are scoped per action instance, so different subjects
can use the same recovery template without colliding.
Binding {binding:"subject"} is restricted to entity-metric actions; nested rules
establish their own binding scope. Each agent qualifies on its own load. Removal
releases its counter because entity IDs are never reused; recovery preserves it.
Limits: 2,000 live subject counters total and the existing 1,000 pending-job budget.

Snapshots include registered contactState.data {sampleTick,dt,impulses}, nullable
sensor records, dwell/fired/cooldown maps and pending subjectId jobs. Native/Wasm
parity and internal serialization resume this state. Public restore/replay remains
part nine. Sensors/state are runtime-only, not writable LLM fields. Solver schemas
are registered in contract/contact.ts; client capability selection exposes
contactLoadRatio only for a validated registered preset.

Runtime spawns now use a1, a2, … consistently with the compiler (older engine
versions used a-N). Stable captured IDs and explicit future clearance cohorts
therefore agree in v8. Existing goal/event/ticket ID formats are unchanged.

The 2,000-agent open-hall host benchmark with contact and a per-agent sensor rule
measured 13.97 ms/pulse mean, 22.85 ms p95 (~96 ticks/CPU second, 80 required at
4×). This excludes actual timers, worker transfer and rendering; dense contact
clusters and 60-rendered-fps acceptance remain part ten.

Open /?demo=contact for the real-worker compression example. Step one tick to
inspect qualification, delayed application and recovery; its model-unit numbers
are scenario settings. The usual service demo and /sim defaults are unchanged.

## Goals and service

All eight goals run through per-agent GoalRuntime: reach, avoid, wait, wander,
follow, queue, interact and nested/repeated sequence. Avoid/follow maintain intent
until replaced/cleared. Wait dwells after zone arrival; wander duration begins in
its zone and samples visible, body-safe destinations within its membership mask.
Follow replans as its target moves. Point fields are shared and obsolete fields
are pruned. Unreachable routes retain intent; failed leaves stop their sequence.

GoalRuntime.execution stores leaf phase, elapsed time and a final local destination;
cursor stores sequence indices/repetitions. navigation.targetPoint is a steering
waypoint. Reaction/immobility pause execution. Internal serialization restores
actual progress, queue order, fractional credit and occupied slots without RNG
redraws. Public restore/replay is still unsupported.

Queue targets need capacity or portal components; interact needs interaction.
Admission is FIFO, requires an open gate/free capacity and respects serviceRate
credit in admissions/second. Credit does not bank while idle. maximumOccupants
bounds concurrent service and admissions/tick; interaction.slots bounds leases.
Queue completion admits without teleportation. Service uses visible, body-safe
approaches to the grid footprint, never a blocked object center or through a wall.
maximumWait timeout fails the leaf. Clear, replacement, immobility and agent
removal release claims. Recovery rejoins at the tail or restarts full interaction.

reach.departOnArrival defaults to false in both goal formats. True records one
departure after full-body entry into the selected zone, or normal arrival at other
static destinations. Departed agents are retained as records but excluded from
collisions. Clear never revives them. Removal records a separate event/count.

Bounds: 8 nesting levels, 1,024 nodes/goal, 64,000 live goal nodes, repeat ≤10,000,
64 immediate transitions/agent/tick, 1,000 pending goals/agent and 10,000 total.
Static entities ≤4,096; total interaction slots ≤10,000. Entity footprint caches
and shape/approach work are bounded; a failed tick batch restores all mutable
agents, services, counters, RNG, departures and events.

## Immediate interventions

Use the existing `apply_request` command with a `create_intervention` request:

```json
{
  "schemaVersion": 1, "simulationId": "engine-demo", "requestId": "close-1",
  "action": "create_intervention", "label": "Close door",
  "operations": [{
    "op": "set", "targets": {"ids": ["door"]},
    "values": {"components": {"portal": {"open": false}}}
  }]
}
```

All ten operations and live selectors are supported as described above. `at`
may be now or future; future interventions become owned pending jobs. Each request
records a revision and exact-content dedupe outcome. Past work, edit/delete and
restore/replay remain rejected. `query: {kind:"history"}` reads records/outcomes;
all five read-query kinds are implemented in part seven.

## Compiler handoff after part six

- Prepared venues use map.grid as the walkability/membership authority. Room and
  portal rectangles must contain their assigned cells; they do not replace masks.
- All eight controllers, compact spawns/jobs and controller rules now work. Keep
  full behavior in compiler output; no stripping of late arrivals or alarms.
  Contact-enabled presets require the registered part-eight solver and valid parameters.
- traversalCost already affects routing. Cost 2 makes a uniform segment twice as
  expensive as cost 1; boundary edges average both costs. It does not halve walking
  speed, change dt, or model uphill physics. Only GridData supports custom costs;
  rows/legend currently initializes all costs to 1.
  Supply the optional terrainSpeedMultiplier array for slow terrain. The shared
  contract, Rust loader, snapshots and typed-buffer copies preserve it. The compiler must pass it through independently from routing cost.
- Desks should remain generic object entities with stable IDs, shape, appearance
  and existing capacity/interaction components in full compiler output. Rasterize
  blocking desk footprints into the grid as well. Cells encode physical exclusion;
  entity records preserve identity and service behavior. Leave accessible approach
  space beside desks; queue/interact cannot target an inaccessible blocked center.
  Static loading and queue/interact now work. Keep full compiler output; do not
  strip desk semantics to get a scene accepted. Scheduled arrivals and alarm rules now run.

## State and bridge

`core.rs` dispatches commands; `world.rs` owns agents/state; `grid.rs` validates
maps; `geometry.rs` checks swept bodies; `navigation.rs` builds/follows fields;
`movement.rs` integrates acceleration, steering and hard collision exclusion;
`goals.rs` owns execution/claims; `shapes.rs` validates entities and approaches;
`portal_changes.rs` commits the narrow intervention subset. `protocol.rs` validates
Rust DTOs. `wasm.rs` exports a manual UTF-8 ABI, wrapped by wasmBindings.ts. Raw
pointers stay inside the binding. ABI/schema remain 1; engine is
`goals-engine-v5`. No wasm-bindgen or new dependencies are required.

Rust time is tick × dt. The worker submits at most 8 automatic ticks/batch,
shrinking batches toward a 12 ms dispatch budget using measured tick cost. It
retains fractional ticks/debt; speed never changes dt. Public step/run_to is
bounded at 100,000 ticks. Reset cancels playback debt and restores paused 1×.
Seeds use versioned FNV-1a UTF-16 stream keys and a wrapping uint32 LCG; input order
does not change per-agent RNG or initial goal allocation. Idle ticks use no draws.

Snapshots include actual goals, timers, targets, topology and history cursor.
Internal serialization rebuilds derived caches without restarting goals or drawing
RNG again. Snapshot restore/replay commands remain unsupported. FNV fingerprints
identify content; they are not authentication. Request dedupe also compares the
actual canonical content, rather than relying on the fingerprint alone.

The 2,000-agent benchmark measures native and validated Wasm dispatch separately;
it excludes actual worker transfer and PixiJS rendering. November 7 arm64 results:
native mean 3.90 ms/tick; Wasm mean 9.33 ms, p95 16.79 ms (~107 ticks/s).
4× at dt=0.05 requires 80 ticks/s. This short open-hall scenario establishes
throughput only; 60 rendered fps and congested-scene performance remain unverified.

8× is available in the demo and requires 160 ticks/s at the same dt. A separate
2,000-agent test measures the actual host's 2/3-tick batches at 60 synthetic pulses
per second: mean 12.78 ms/pulse, p95 19.90 ms, ~209 ticks per CPU second. Batching
amortizes rollback-state copying and JSON/frame validation. This clears the compute
budget in the short open-hall case; real timers, transfer and rendering are excluded.

With a pending job and live count rule, the same 2,000-agent host at 4× measured
11.41 ms/pulse mean, 19.17 ms p95 and ~117 ticks/CPU second (80 required). This
includes scheduling/count evaluation but excludes browser timers, transfer and
rendering; it is not a congested-service or mass-geometry-edit benchmark.

Contact is opt-in; replay remains pending. Contact samples are not fabricated.

## Product frontend

`/sim` still defaults to the mock. `/sim?engine=real` selects the Rust worker
through the existing SimulationClient/PixiJS renderer. It explicitly compiles the
worked scenario with a labelled movement-only preset (no contact solver). All
five compiled picker scenarios load, step and accept changes in actual Wasm/client
tests. /sim?engine=real now receives real metrics/density/events; no mock values
are substituted. The renderer retains its own Gaussian visual smoothing. Browser rendering/fps has not been verified in this environment.

### Worked-scenario movement (engine v8.1)

Evacuation selectors specify `kind: "agent"`; shared room tags must not turn an
alarm into a failed agent assignment. School/concert evacuation goals explicitly
set `departOnArrival: true`. Hackathon arrivals reach the hall then wander; this
demo does not simulate check-in service.

Flow navigation connects valid wall-tangent positions to nearby reachable cells
and looks ahead up to eight cells, retaining wall clearance, anchored bodies,
one-way restrictions and portal delays. Hard movement tests a bounded fan of
velocities and rejects predicted approaching body collisions over 0.75 seconds
before packing into a doorway. Swept-disc checks still prevent actual overlap.
These steering preferences generate no physical contact loads or falls.

Rebuild Wasm after updating (`npm run build:wasm`) and reset/reload the scene.
Use `/sim?engine=real` for actual Rust behavior; the default mock is a UI stub.
Native/Wasm regressions check that all ten worked-example attendees depart,
including late arrivals, rather than only checking that the alarm changed goals.

Regression coverage: actual Wasm clears 10/10 worked-example attendees, 192/192
school occupants and 430/430 concert attendees; all 40 hackathon arrivals reach
the hall and begin wandering. Both alley directions make crossings. Venue runs
use a 600-second completion budget (180 seconds for the continuous alley demo);
this is a liveness check, not a calibrated evacuation-time claim. Native/Wasm
parity, closed/one-way doors, traversal delays, anchored bodies, terrain costs,
wall clearance and compression-fall tests remain required.

Latest v8.1 open-hall benchmark (2,000 moving agents): the 4× worker with a
pending job/live count rule reaches 81.6 ticks per CPU second (80 required;
p95 publication pulse 27.29 ms). Contact plus per-agent rules reaches 66.4
ticks/s and misses that budget; 8× reaches 144.1 ticks/s against 160 required.
Single-tick validated Wasm reaches 74.9 ticks/s; batching matters. These numbers
exclude worker transfer/rendering and do not establish browser 60 FPS. Earlier
v8 timings above are historical; full performance acceptance remains part 10.

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
