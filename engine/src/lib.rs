//! Authoritative initialized worlds and fixed simulation clocks; movement follows.
mod core;
mod geometry;
mod grid;
mod navigation;
mod portal_changes;
mod protocol;
pub mod random;
mod world;
pub use core::{ABI_VERSION, ENGINE_VERSION, Engine};

#[cfg(any(target_arch = "wasm32", test))]
mod wasm;
