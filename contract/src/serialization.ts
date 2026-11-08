import type { Result } from './common.js';
import { GridDataSchema, type GridData } from './editor.js';
import { parseContract, type ValidationOptions } from './validation.js';

export type GridBuffers = Omit<GridData, 'blocked' | 'traversalCost' | 'zoneIndex' | 'portalIndex' | 'terrainSpeedMultiplier'> & {
  blocked: Uint8Array; traversalCost: Float32Array; zoneIndex: Uint32Array; portalIndex: Uint32Array;
  terrainSpeedMultiplier?: Float32Array;
};

/** Copies buffers; callers retain ownership of engine state. Costs use Float32 precision. */
export function gridToBuffers(input: unknown, options?: ValidationOptions): Result<GridBuffers> {
  const parsed = parseContract(GridDataSchema, input, options);
  if (!parsed.ok) return parsed;
  const grid = parsed.value;
  const { terrainSpeedMultiplier: terrainInput, ...base } = grid;
  const traversalCost = new Float32Array(grid.traversalCost);
  if (traversalCost.some((cost, i) => !Number.isFinite(cost) || (grid.blocked[i] === 0 && cost <= 0))) return { ok: false, error: { code: 'INVALID_SCHEMA', message: 'Traversal cost cannot be represented as Float32' } };
  const terrainSpeedMultiplier = terrainInput && new Float32Array(terrainInput);
  if (terrainSpeedMultiplier?.some((speed) => !Number.isFinite(speed) || speed <= 0)) return { ok: false, error: { code: 'INVALID_SCHEMA', message: 'Terrain speed cannot be represented as Float32' } };
  return { ok: true, value: { ...base, ...(terrainSpeedMultiplier ? { terrainSpeedMultiplier } : {}), blocked: new Uint8Array(grid.blocked), traversalCost, zoneIndex: new Uint32Array(grid.zoneIndex), portalIndex: new Uint32Array(grid.portalIndex) } };
}

export function gridFromBuffers(grid: GridBuffers, options?: ValidationOptions): Result<GridData> {
  return parseContract(GridDataSchema, { ...grid, ...(grid.terrainSpeedMultiplier ? { terrainSpeedMultiplier: Array.from(grid.terrainSpeedMultiplier) } : {}), blocked: Array.from(grid.blocked), traversalCost: Array.from(grid.traversalCost), zoneIndex: Array.from(grid.zoneIndex), portalIndex: Array.from(grid.portalIndex) }, options);
}
