//! Authoritative worlds, fixed ticks and collision-safe local movement.
mod core;
mod geometry;
mod grid;
mod movement;
mod navigation;
mod portal_changes;
mod protocol;
pub mod random;
mod world;
pub use core::{ABI_VERSION, ENGINE_VERSION, Engine};

#[cfg(any(target_arch = "wasm32", test))]
mod wasm;
