//! Static scene loading and publication. Fixed-step simulation follows in part two.
mod core;
mod protocol;
pub use core::{ABI_VERSION, ENGINE_VERSION, Engine};

#[cfg(any(target_arch = "wasm32", test))]
mod wasm;
