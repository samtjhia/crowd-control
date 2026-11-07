//! Authoritative initialized worlds and fixed simulation clocks; movement follows.
mod core;
mod grid;
mod protocol;
pub mod random;
mod world;
pub use core::{ABI_VERSION, ENGINE_VERSION, Engine};

#[cfg(any(target_arch = "wasm32", test))]
mod wasm;
