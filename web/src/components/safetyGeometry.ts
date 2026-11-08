export type ScenePoint = readonly [number, number, number?]

/** Shared ground projection keeps architecture and HTML annotation leaders aligned. */
export const project = ([x, y, z = 0]: ScenePoint) => ({
  x: 175 + x * 1.08 - y * .5,
  y: 100 + x * .2 + y * .72 - z,
})
