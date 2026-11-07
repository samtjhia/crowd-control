# Contract fixtures

The scenario plan, compiled scene, runtime agent, compression rule and three
follow-up requests are copied from the Technical PRD. Worker apply/ack/frame
messages come from the contracts document.

`compile-output.json` supplies the example's resolved model and inventory.
`snapshot.json` is synthetic state covering sensors, compression dwell counters,
queues/slots, overlays, pending work, allocation reservations and random streams.
Its contact solver/version/data are test fixtures, not implemented physics.

Tests validate and round-trip these files without normalizing their contents.
They do not run a compiler, measure physical behavior or execute replay.

`engine-load.json` is a complete small worker load message for starting engine
development: two initial attendees, one future arrival, and an alarm-driven exit.
It has no contact model. Its model parameters are illustrative, not calibrated.

`engine-static-load.json` removes controllers, controller references, jobs and
rules from engine-load.json. It is the supported part-one input. Native Rust
integration tests validate its output with the shared worker schemas. This does
not establish browser/Wasm acceptance, which needs the installed Rust target.
