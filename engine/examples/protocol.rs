//! Native protocol smoke test: one JSON command per stdin line.
use crowd_control_engine::Engine;
use std::io::{self, BufRead};
fn main() {
    let mut engine = Engine::default();
    for line in io::stdin().lock().lines() {
        println!("{}", engine.dispatch(&line.expect("stdin")));
    }
}
