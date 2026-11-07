//! lcg32-v1: FNV-1a over UTF-16 purpose/ID keys, mixed with the master seed.
pub fn stream_seed(seed: u32, key: &str) -> u32 {
    key.encode_utf16().fold(0x811c9dc5 ^ seed, |h, ch| {
        (h ^ u32::from(ch)).wrapping_mul(0x01000193)
    })
}
pub fn next(state: &mut u32) -> u32 {
    *state = state.wrapping_mul(1664525).wrapping_add(1013904223);
    *state
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn follows_the_prd_stream_and_continues_after_serialization() {
        let mut state = 42;
        assert_eq!(next(&mut state), 1083814273);
        let saved = serde_json::to_string(&state).unwrap();
        let mut restored = serde_json::from_str(&saved).unwrap();
        assert_eq!(next(&mut state), next(&mut restored));
        assert_ne!(stream_seed(42, "agent:a1"), stream_seed(42, "placement"));
        assert_ne!(stream_seed(42, "agent:a1"), stream_seed(42, "agent:a2"));
    }
}
