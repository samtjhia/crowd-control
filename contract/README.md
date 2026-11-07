# Shared contracts

Schema version **1**, Wasm ABI **1**. Import types and validators from
`@crowd-control/contract`. Public data types are inferred from Zod schemas;
recursive edges and callback interfaces have explicit TypeScript definitions.

| Module | Boundary |
| --- | --- |
| `common`, `entities`, `operations` | Geometry, appearance, components, selectors, goals, ten operations |
| `planner` | Layout requests, plans, follow-ups, capabilities, planner replies |
| `editor`, `world` | Source pixels, calibration, reviewed grids, compile input/output |
| `runtime`, `history`, `metrics` | Agent state, sensors, snapshots, revisions, queues, events, queries |
| `worker`, `ui` | Commands, frames, render metadata, endpoint and chat callbacks |
| `adapters` | Persistence DTOs, environment configuration, Rust/Wasm interface |
| `validation`, `serialization` | Boundary parsing, JSON encoding, copied grid buffers |

```ts
import { parseScenarioPlan, type Capabilities } from '@crowd-control/contract';

function acceptPlan(payload: unknown, capabilities: Capabilities) {
  const result = parseScenarioPlan(payload, { capabilities });
  if (!result.ok) return result.error;
  return result.value;
}
```

Use `parseContract(schema, payload, options)` or the named `parse*` helpers at
untrusted boundaries. `decodeContract` additionally parses JSON strings;
`encodeContract` validates before serialization. Errors return `Result<T>`.
Low-level `*Schema` exports validate structure/ranges; contextual checks belong to
the helpers. Supply the engine's actual `capabilities` and configured `limits`.

Helpers reject unknown fields, non-JSON values, unsafe property names, invalid
patches, unbound subjects and unavailable sensors. Entity-metric actions bind
`subject`; scheduled descendants inherit that scope and nested rules establish
their own. Runtime scheduling must replace captured subjects with stable IDs.
Contact samples are nullable; automatic-fall rules use only `contactLoadRatio`.
Snapshots require an engine version and a registered `contactStateSchemas` entry
for non-null solver state. The engine implementation must validate solver parameters
and version compatibility.

Transport limits: 64 nesting levels, 1,000,000 visited JSON values, and 32 MiB for
decoded JSON text. Polygon validation allows 512 vertices. These bounds supplement
the supplied application limits. Bound HTTP/upload bodies before parsing them.
Grid adapters copy buffers; traversal costs round to Float32 and reject overflow
or walkable-cell underflow. JSON snapshots retain ordinary arrays and RNG state.

`plannerJsonSchema()` exports the writable reply union as standard JSON Schema.
It includes recursive references; a bounded, model-specific Gemini adapter is
still required. Runtime, worker, auth and storage records stay outside that schema.

```sh
npm run test --workspace @crowd-control/contract
npm run typecheck --workspace @crowd-control/contract
```

The fixtures test data interchange. Compiler geometry/placement, live selector
resolution, physics/fall transitions, replay commits, Rust Serde/ABI bindings,
PixiJS rendering and the 2,000-agent/4×/60-fps target remain implementation work.

## Engine input example

`fixtures/engine-load.json` is a complete WorkerCommand load payload: CompileOutput
plus an empty initial history. Two agents wander, one arrives at simulation second
5, and the alarm at second 10 assigns all current attendees the leave controller.
The dimensions are model units. Contact physics is omitted from this movement
example; it does not enable compression-triggered falls.

On load, expand rows/legend into grid membership, resolve preset → profile → agent
overrides, and create independent AgentRuntime records with zero velocities,
nullable sensors, goal progress, timers and seeded RNG. Expand compact spawn/event
rules into ordinary engine instructions. Preserve future selectors and find spawn
positions against occupancy when due. The initial agents already exist in the
compiled scene: do not spawn them again from history.

Step at fixed dt (0.05 s here), execute due jobs/rules, update navigation/movement,
then publish versioned scene/frame/metric messages. Appearance only affects
render metadata. B owns position handling; the engine applies updates in worker
state. Pin the actual engine build in versions.engine for saved runs.
