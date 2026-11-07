/**
 * The Technical PRD §10 generator (version `lcg32-v1`, shared with the engine): a 32-bit LCG
 * with multiplier 1664525 and increment 1013904223. `next()` returns a number in [0, 1).
 */
export function seeded(seed: number) {
  let state = seed >>> 0
  return {
    next(): number {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0
      return state / 4294967296
    },
    get state() {
      return state
    },
  }
}
