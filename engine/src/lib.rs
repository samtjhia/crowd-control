//! Authoritative worlds, fixed ticks and collision-safe local movement.
mod core;
mod geometry;
mod goals;
mod grid;
mod movement;
mod navigation;
mod operations;
mod portal_changes;
mod protocol;
pub mod random;
mod scheduling;
mod selectors;
mod shapes;
mod world;
pub use core::{ABI_VERSION, ENGINE_VERSION, Engine};

#[cfg(any(target_arch = "wasm32", test))]
mod wasm;
