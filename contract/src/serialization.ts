import type { Result } from './common.js';
import { GridDataSchema, type GridData } from './editor.js';
import { parseContract, type ValidationOptions } from './validation.js';

export type GridBuffers = Omit<GridData, 'blocked' | 'traversalCost' | 'zoneIndex' | 'portalIndex'> & {
  blocked: Uint8Array; traversalCost: Float32Array; zoneIndex: Uint32Array; portalIndex: Uint32Array;
};

/** Copies buffers; callers retain ownership of engine state. Costs use Float32 precision. */
export function gridToBuffers(input: unknown, options?: ValidationOptions): Result<GridBuffers> {
  const parsed = parseContract(GridDataSchema, input, options);
  if (!parsed.ok) return parsed;
  const grid = parsed.value;
  const traversalCost = new Float32Array(grid.traversalCost);
  if (traversalCost.some((cost, i) => !Number.isFinite(cost) || (grid.blocked[i] === 0 && cost <= 0))) return { ok: false, error: { code: 'INVALID_SCHEMA', message: 'Traversal cost cannot be represented as Float32' } };
  return { ok: true, value: { ...grid, blocked: new Uint8Array(grid.blocked), traversalCost, zoneIndex: new Uint32Array(grid.zoneIndex), portalIndex: new Uint32Array(grid.portalIndex) } };
}

export function gridFromBuffers(grid: GridBuffers, options?: ValidationOptions): Result<GridData> {
  return parseContract(GridDataSchema, { ...grid, blocked: Array.from(grid.blocked), traversalCost: Array.from(grid.traversalCost), zoneIndex: Array.from(grid.zoneIndex), portalIndex: Array.from(grid.portalIndex) }, options);
}
